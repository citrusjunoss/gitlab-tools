import {
  deleteProjectBranch,
  getProjectTags,
  listProjectBranches,
  listProjectMergeRequests,
} from '@/services/gitlab';
import { getItem, setItem } from '@/utils/storage';
import { PageContainer } from '@ant-design/pro-components';
import { useModel } from '@umijs/max';
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

type CleanupStatus = 'pending' | 'skipped' | 'deleted' | 'failed';

interface CleanupPlan {
  projectId: number;
  projectLabel: string;
  projectWebUrl: string;
  branchName: string;
  lastCommitDate: string;
  reason: string;
  status: CleanupStatus;
  detail: string;
  isProtected: boolean;
  isDefault: boolean;
  isMerged: boolean;
  hasTagAtHead: boolean;
}

interface BranchInfo {
  name: string;
  default?: boolean;
  protected?: boolean;
  merged?: boolean;
  commit?: {
    id?: string;
    committed_date?: string;
    created_at?: string;
  };
}

interface TagInfo {
  commit?: {
    id?: string;
  };
}

const PLAN_CACHE_KEY = 'branchCleanupPlans';
const DEFAULT_THRESHOLD_DAYS = 90;
const DEFAULT_TARGET_BRANCH = 'release';

const { Paragraph, Text } = Typography;

const isActionablePlan = (plan: CleanupPlan) =>
  ['pending', 'failed'].includes(plan.status) && plan.branchName !== '-';

const getErrorMessage = (error: any, fallback: string) => {
  const detail =
    error?.data?.message ||
    error?.response?.data?.message ||
    error?.message ||
    fallback;
  return typeof detail === 'string' ? detail : fallback;
};

const formatDate = (value?: string) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { hour12: false });
};

const getTimeValue = (value?: string) => {
  if (!value) return 0;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
};

const withPagination = async <T,>(
  loader: (page: number) => Promise<T[]>,
  startPage = 1,
  pageSize = 100,
) => {
  const result: T[] = [];
  let page = startPage;
  let hasMore = true;
  while (hasMore) {
    // eslint-disable-next-line no-await-in-loop
    const items = await loader(page);
    const list = Array.isArray(items) ? items : [];
    result.push(...list);
    if (list.length < pageSize) {
      hasMore = false;
    } else {
      page += 1;
    }
  }
  return result;
};

const BranchCleanupPage: React.FC = () => {
  const { token, allProjects, allGroups, init, fetchAllGroups } =
    useModel('gitlabModel');
  const [form] = Form.useForm();
  const [groupFilter, setGroupFilter] = useState<number[]>([]);
  const [plans, setPlans] = useState<CleanupPlan[]>([]);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [batchSubmitting, setBatchSubmitting] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [messageApi, contextHolder] = message.useMessage();

  useEffect(() => {
    if (token && allGroups.length === 0) {
      fetchAllGroups();
    }
  }, [token, allGroups.length, fetchAllGroups]);

  useEffect(() => {
    form.setFieldsValue({
      thresholdDays: DEFAULT_THRESHOLD_DAYS,
      targetBranch: DEFAULT_TARGET_BRANCH,
    });
  }, [form]);

  useEffect(() => {
    const loadCachedPlans = async () => {
      if (!token) {
        setPlans([]);
        setSelectedRowKeys([]);
        return;
      }
      const cachedPlans = await getItem<CleanupPlan[]>(PLAN_CACHE_KEY, token);
      if (cachedPlans && cachedPlans.length > 0) {
        setPlans(cachedPlans);
        setSelectedRowKeys(
          cachedPlans
            .filter((plan) => ['pending', 'failed'].includes(plan.status))
            .map((plan) => `${plan.projectId}:${plan.branchName}`),
        );
      }
    };
    loadCachedPlans();
  }, [token]);

  const persistPlans = useCallback(
    (nextPlans: CleanupPlan[]) => {
      if (!token) return;
      setItem(PLAN_CACHE_KEY, nextPlans, token).catch((error) => {
        console.error('Failed to persist branch cleanup plans', error);
      });
    },
    [token],
  );

  const groupOptions = useMemo(
    () =>
      allGroups.map((group) => ({
        label: group.full_path,
        value: group.id,
      })),
    [allGroups],
  );

  const projectOptions = useMemo(() => {
    const filtered =
      groupFilter.length > 0
        ? allProjects.filter((project) =>
            project?.namespace
              ? groupFilter.includes(project.namespace.id)
              : false,
          )
        : allProjects;
    return filtered.map((project: any) => ({
      label: project.name_with_namespace || project.name,
      value: project.id,
      searchKey: `${project.name_with_namespace || ''} ${
        project.path_with_namespace || ''
      }`.trim(),
    }));
  }, [allProjects, groupFilter]);

  const rowSelection = {
    selectedRowKeys,
    onChange: (keys: React.Key[]) => {
      const valid = (keys as string[]).filter((key) => {
        const plan = plans.find(
          (item) => `${item.projectId}:${item.branchName}` === key,
        );
        return plan && isActionablePlan(plan);
      });
      setSelectedRowKeys(valid);
    },
    getCheckboxProps: (record: CleanupPlan) => ({
      disabled: !isActionablePlan(record),
    }),
  };

  useEffect(() => {
    setSelectedRowKeys((prev) =>
      prev.filter((key) => {
        const plan = plans.find(
          (item) => `${item.projectId}:${item.branchName}` === key,
        );
        return plan && isActionablePlan(plan);
      }),
    );
  }, [plans]);

  const fetchAllBranches = useCallback(
    async (projectId: number) => {
      const branches = await withPagination<BranchInfo>(async (page) =>
        listProjectBranches(projectId, token, { page, per_page: 100 }),
      );
      return branches;
    },
    [token],
  );

  const fetchAllTags = useCallback(
    async (projectId: number) => {
      const tags = await withPagination<TagInfo>(async (page) =>
        getProjectTags(projectId, token, { page, per_page: 100 }),
      );
      return tags;
    },
    [token],
  );

  const fetchAllMergedMrs = useCallback(
    async (projectId: number, targetBranch: string) => {
      const mrs = await withPagination<any>(async (page) =>
        listProjectMergeRequests(projectId, token, {
          page,
          per_page: 100,
          state: 'merged',
          target_branch: targetBranch,
        }),
      );
      return mrs;
    },
    [token],
  );

  const buildPlanForProject = useCallback(
    async (
      project: any,
      thresholdDays: number,
      targetBranch: string,
    ): Promise<CleanupPlan[]> => {
      const base = {
        projectId: project.id,
        projectLabel: project.name_with_namespace || project.name,
        projectWebUrl: project.web_url,
      };

      if (!token) {
        return [
          {
            ...base,
            branchName: '-',
            lastCommitDate: '-',
            reason: '缺少 Token',
            status: 'failed',
            detail: '请先在系统配置中设置 GitLab Token',
            isProtected: false,
            isDefault: false,
            isMerged: false,
            hasTagAtHead: false,
          },
        ];
      }

      try {
        const [branches, tags, mergedMrs] = await Promise.all([
          fetchAllBranches(project.id),
          fetchAllTags(project.id),
          fetchAllMergedMrs(project.id, targetBranch),
        ]);

        const tagCommitIds = new Set(
          tags
            .map((tag) => tag?.commit?.id)
            .filter((id): id is string => Boolean(id)),
        );
        const mergedSourceBranches = new Set(
          mergedMrs
            .map((mr) => mr?.source_branch)
            .filter((name): name is string => Boolean(name)),
        );
        const thresholdTime = Date.now() - thresholdDays * 24 * 60 * 60 * 1000;

        return branches
          .filter((branch) => branch?.name)
          .map((branch) => {
            const commitDate =
              branch.commit?.committed_date || branch.commit?.created_at || '';
            const commitTime = getTimeValue(commitDate);
            const isDefault = Boolean(branch.default);
            const isProtected = Boolean(branch.protected);
            const isMerged = Boolean(
              branch.merged || mergedSourceBranches.has(branch.name),
            );
            const hasTagAtHead = Boolean(
              branch.commit?.id && tagCommitIds.has(branch.commit.id),
            );
            const isExpired = commitTime > 0 && commitTime < thresholdTime;
            const eligible =
              !isDefault &&
              !isProtected &&
              (isExpired || (isMerged && hasTagAtHead));
            const reason = isExpired
              ? `最后提交超过 ${thresholdDays} 天`
              : isMerged && hasTagAtHead
              ? `已合并到 ${targetBranch} 且 HEAD 已打 tag`
              : '未满足清理条件';

            return {
              ...base,
              branchName: branch.name,
              lastCommitDate: commitDate,
              reason,
              status: eligible ? 'pending' : 'skipped',
              detail: eligible
                ? reason
                : isDefault
                ? '默认分支，跳过'
                : isProtected
                ? '受保护分支，跳过'
                : '未命中过期规则',
              isProtected,
              isDefault,
              isMerged,
              hasTagAtHead,
            };
          });
      } catch (error: any) {
        return [
          {
            ...base,
            branchName: '-',
            lastCommitDate: '-',
            reason: '读取失败',
            status: 'failed',
            detail: getErrorMessage(error, '读取分支列表失败'),
            isProtected: false,
            isDefault: false,
            isMerged: false,
            hasTagAtHead: false,
          },
        ];
      }
    },
    [fetchAllBranches, fetchAllMergedMrs, fetchAllTags, token],
  );

  const handlePreview = async () => {
    try {
      const values = await form.validateFields();
      if (!token) {
        messageApi.warning('请先在系统配置中设置 GitLab Token');
        return;
      }
      const projectIds: number[] = values.projectIds || [];
      const thresholdDays = Number(
        values.thresholdDays || DEFAULT_THRESHOLD_DAYS,
      );
      const targetBranch = values.targetBranch || DEFAULT_TARGET_BRANCH;

      if (projectIds.length === 0) {
        messageApi.warning('请至少选择一个项目');
        return;
      }

      setLoadingPreview(true);
      const nextPlans: CleanupPlan[] = [];
      for (const projectId of projectIds) {
        const project = allProjects.find((item: any) => item.id === projectId);
        if (!project) {
          continue;
        }
        // eslint-disable-next-line no-await-in-loop
        const projectPlans = await buildPlanForProject(
          project,
          thresholdDays,
          targetBranch,
        );
        nextPlans.push(...projectPlans);
      }
      setPlans(nextPlans);
      setSelectedRowKeys(
        nextPlans
          .filter((plan) => isActionablePlan(plan))
          .map((plan) => `${plan.projectId}:${plan.branchName}`),
      );
      persistPlans(nextPlans);
      messageApi.success(
        `生成 ${
          nextPlans.filter((plan) => plan.status === 'pending').length
        } 个可执行清理项`,
      );
    } catch (error: any) {
      if (error?.errorFields) {
        return;
      }
      messageApi.error(getErrorMessage(error, '生成清理计划失败'));
    } finally {
      setLoadingPreview(false);
    }
  };

  const applyDeleteResult = (
    projectId: number,
    branchName: string,
    updater: (plan: CleanupPlan) => CleanupPlan,
  ) => {
    setPlans((prev) => {
      const next = prev.map((item) =>
        item.projectId === projectId && item.branchName === branchName
          ? updater(item)
          : item,
      );
      persistPlans(next);
      return next;
    });
  };

  const handleDelete = useCallback(
    async (plan: CleanupPlan) => {
      if (!token) {
        messageApi.warning('请先在系统配置中设置 GitLab Token');
        return;
      }
      applyDeleteResult(plan.projectId, plan.branchName, (item) => ({
        ...item,
        detail: '执行中...',
      }));
      try {
        await deleteProjectBranch(plan.projectId, plan.branchName, token);
        applyDeleteResult(plan.projectId, plan.branchName, (item) => ({
          ...item,
          status: 'deleted',
          detail: '已删除',
        }));
        messageApi.success(`${plan.projectLabel} / ${plan.branchName} 已删除`);
      } catch (error: any) {
        const detail = getErrorMessage(error, '删除分支失败');
        applyDeleteResult(plan.projectId, plan.branchName, (item) => ({
          ...item,
          status: 'failed',
          detail,
        }));
        messageApi.error(`${plan.projectLabel}: ${detail}`);
      }
    },
    [messageApi, token],
  );

  const handleBatchDelete = () => {
    const selectedPlans = plans
      .filter((plan) =>
        selectedRowKeys.includes(`${plan.projectId}:${plan.branchName}`),
      )
      .filter(isActionablePlan);
    if (selectedPlans.length === 0) {
      messageApi.info('请选择需要删除的分支');
      return;
    }
    Modal.confirm({
      title: '确认批量删除分支',
      content: (
        <div>
          <p>将删除以下 {selectedPlans.length} 个分支：</p>
          <ol style={{ paddingLeft: 16 }}>
            {selectedPlans.map((plan) => (
              <li key={`${plan.projectId}-${plan.branchName}`}>
                {plan.projectLabel} / {plan.branchName}{' '}
                <Text type="secondary">({plan.reason})</Text>
              </li>
            ))}
          </ol>
        </div>
      ),
      okText: '确认删除',
      cancelText: '取消',
      onOk: async () => {
        setBatchSubmitting(true);
        try {
          for (const plan of selectedPlans) {
            // eslint-disable-next-line no-await-in-loop
            await handleDelete(plan);
          }
        } finally {
          setBatchSubmitting(false);
        }
      },
    });
  };

  const columns: ColumnsType<CleanupPlan> = [
    {
      title: '项目',
      dataIndex: 'projectLabel',
      render: (_: string, record) => (
        <a href={record.projectWebUrl} target="_blank" rel="noreferrer">
          {record.projectLabel}
        </a>
      ),
    },
    {
      title: '分支',
      dataIndex: 'branchName',
      render: (value: string) => <Text code>{value}</Text>,
    },
    {
      title: '最后提交',
      dataIndex: 'lastCommitDate',
      render: (value: string) => formatDate(value),
    },
    {
      title: '命中原因',
      dataIndex: 'reason',
    },
    {
      title: '标记',
      render: (_: any, record) => (
        <Space wrap>
          {record.isDefault && <Tag color="blue">默认</Tag>}
          {record.isProtected && <Tag color="purple">受保护</Tag>}
          {record.isMerged && <Tag color="green">已合并</Tag>}
          {record.hasTagAtHead && <Tag color="gold">已打 Tag</Tag>}
        </Space>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      render: (status: CleanupStatus, record) => {
        const colorMap: Record<CleanupStatus, string> = {
          pending: 'processing',
          skipped: 'default',
          deleted: 'success',
          failed: 'error',
        };
        const textMap: Record<CleanupStatus, string> = {
          pending: '待删除',
          skipped: '已跳过',
          deleted: '已删除',
          failed: '失败',
        };
        return (
          <Space direction="vertical" size={0}>
            <Tag color={colorMap[status]}>{textMap[status]}</Tag>
            <Text type={status === 'failed' ? 'danger' : 'secondary'}>
              {record.detail}
            </Text>
          </Space>
        );
      },
    },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record) => (
        <Button
          type="primary"
          size="small"
          disabled={!isActionablePlan(record)}
          onClick={() => {
            Modal.confirm({
              title: '确认删除分支',
              content: (
                <div>
                  <p>
                    将删除 <Text strong>{record.projectLabel}</Text> 下的分支{' '}
                    <Text code>{record.branchName}</Text>
                  </p>
                  <p>
                    <Text type="secondary">{record.reason}</Text>
                  </p>
                </div>
              ),
              okText: '确认删除',
              cancelText: '取消',
              onOk: () => handleDelete(record),
            });
          }}
        >
          删除分支
        </Button>
      ),
    },
  ];

  return (
    <PageContainer
      title="分支清理"
      subTitle="批量清理过时分支：最后提交超过 90 天，或已合并到 release 且 HEAD 已打 tag"
    >
      {contextHolder}
      {!token && (
        <Alert
          type="warning"
          showIcon
          message="请先在系统配置中配置 GitLab 实例地址和 Token"
          style={{ marginBottom: 24 }}
        />
      )}
      <Spin spinning={!init}>
        <Card title="生成清理计划" variant="outlined">
          <Form
            form={form}
            layout="vertical"
            onValuesChange={(changedValues) => {
              if (changedValues.groupIds !== undefined) {
                setGroupFilter(changedValues.groupIds || []);
              }
            }}
          >
            <Form.Item label="群组（用于过滤项目）" name="groupIds">
              <Select
                mode="multiple"
                allowClear
                placeholder="不选择则默认展示所有已缓存项目"
                options={groupOptions}
                showSearch
                optionFilterProp="label"
              />
            </Form.Item>
            <Form.Item
              label="项目"
              name="projectIds"
              rules={[{ required: true, message: '请选择需要清理分支的项目' }]}
            >
              <Select
                mode="multiple"
                allowClear
                placeholder="搜索项目名称或路径"
                options={projectOptions}
                showSearch
                optionFilterProp="label"
              />
            </Form.Item>
            <Space
              size={16}
              style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}
            >
              <Form.Item
                label="阈值（天）"
                name="thresholdDays"
                rules={[{ required: true, message: '请输入天数阈值' }]}
                style={{ marginBottom: 0 }}
              >
                <InputNumber min={1} max={3650} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item
                label="目标分支"
                name="targetBranch"
                tooltip="默认使用 release 分支"
                style={{ marginBottom: 0 }}
              >
                <Input
                  placeholder="release"
                  disabled
                  style={{ backgroundColor: '#fafafa' }}
                />
              </Form.Item>
            </Space>
            <Form.Item style={{ marginTop: 24, marginBottom: 0 }}>
              <Space>
                <Button
                  type="primary"
                  onClick={handlePreview}
                  loading={loadingPreview}
                >
                  生成清理计划
                </Button>
                <Button
                  onClick={() => {
                    form.resetFields();
                    setGroupFilter([]);
                    setPlans([]);
                    setSelectedRowKeys([]);
                    persistPlans([]);
                    form.setFieldsValue({
                      thresholdDays: DEFAULT_THRESHOLD_DAYS,
                      targetBranch: DEFAULT_TARGET_BRANCH,
                    });
                  }}
                >
                  重置
                </Button>
              </Space>
            </Form.Item>
          </Form>
          <Alert
            type="info"
            showIcon
            style={{ marginTop: 20 }}
            message="默认跳过默认分支和受保护分支。删除前会先生成计划，再逐项确认。"
          />
        </Card>

        <Card
          title="执行计划"
          style={{ marginTop: 24 }}
          extra={
            <Button
              type="primary"
              disabled={!selectedRowKeys.length}
              loading={batchSubmitting}
              onClick={handleBatchDelete}
            >
              批量删除已选分支
            </Button>
          }
        >
          <Table
            rowKey={(record) => `${record.projectId}:${record.branchName}`}
            columns={columns}
            dataSource={plans}
            rowSelection={rowSelection}
            pagination={false}
            expandable={{
              expandedRowRender: (record) => (
                <Paragraph style={{ marginBottom: 0 }}>
                  <Text strong>清理依据</Text>
                  <pre style={{ whiteSpace: 'pre-wrap', margin: '6px 0 0' }}>
                    {record.detail}
                  </pre>
                </Paragraph>
              ),
            }}
            locale={{
              emptyText: loadingPreview ? '计划生成中...' : '请先生成清理计划',
            }}
          />
        </Card>
      </Spin>
    </PageContainer>
  );
};

export default BranchCleanupPage;
