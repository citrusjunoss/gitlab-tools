import {
  compareProjectRefs,
  createProjectTag,
  getProjectBranch,
  getProjectTag,
  getProjectTags,
  listProjectCommits,
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

type PlanStatus = 'pending' | 'success' | 'failed';
type TagType = 'Hotfix' | 'Tag';

interface CommitEntry {
  title: string;
  sha: string;
  webUrl: string;
}

interface AutoTagPlan {
  projectId: number;
  projectLabel: string;
  projectWebUrl: string;
  branch: string;
  latestTag?: string;
  rangeFrom?: string;
  headCommitSha: string;
  commitDateLabel: string;
  tagName: string;
  tagType?: TagType;
  tagMessage: string;
  entries: CommitEntry[];
  status: PlanStatus;
  detail?: string;
  creatorEmail?: string;
  finishedAt?: string;
}

const { Paragraph, Text } = Typography;

const PLAN_CACHE_KEY = 'autoTagPlans';

const formatDateLabel = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    const now = new Date();
    return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(
      2,
      '0',
    )}${String(now.getDate()).padStart(2, '0')}`;
  }
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(
    2,
    '0',
  )}${String(date.getDate()).padStart(2, '0')}`;
};

const AutoTagPage: React.FC = () => {
  const {
    token,
    branch: branchFromModel,
    allProjects,
    allGroups,
    init,
    currentUser,
    fetchAllGroups,
  } = useModel('gitlabModel');
  const [form] = Form.useForm();
  const [groupFilter, setGroupFilter] = useState<number[]>([]);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [plans, setPlans] = useState<AutoTagPlan[]>([]);
  const [batchSubmitting, setBatchSubmitting] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([]);
  const [messageApi, contextHolder] = message.useMessage();

  useEffect(() => {
    if (token && allGroups.length === 0) {
      fetchAllGroups();
    }
  }, [token, allGroups.length, fetchAllGroups]);

  useEffect(() => {
    const loadCachedPlans = async () => {
      if (!token) {
        setPlans([]);
        setSelectedRowKeys([]);
        return;
      }
      const cachedPlans = await getItem<AutoTagPlan[]>(PLAN_CACHE_KEY, token);
      if (cachedPlans && cachedPlans.length > 0) {
        setPlans(cachedPlans);
        setSelectedRowKeys(
          cachedPlans
            .filter((plan) => plan.status !== 'success')
            .map((plan) => plan.projectId),
        );
      }
    };
    loadCachedPlans();
  }, [token]);

  useEffect(() => {
    form.setFieldsValue({
      targetBranch: branchFromModel || 'release',
    });
  }, [branchFromModel, form]);

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
  const hasSelectablePlan = selectedRowKeys.length > 0;

  const rowSelection = {
    selectedRowKeys,
    onChange: (keys: React.Key[]) => {
      const valid = (keys as number[]).filter((key) => {
        const plan = plans.find((item) => item.projectId === key);
        return plan && plan.status !== 'success';
      });
      setSelectedRowKeys(valid);
    },
    getCheckboxProps: (record: AutoTagPlan) => ({
      disabled: record.status === 'success',
    }),
  };

  useEffect(() => {
    setSelectedRowKeys((prev) =>
      prev.filter((key) => {
        const plan = plans.find((item) => item.projectId === key);
        return plan && plan.status !== 'success';
      }),
    );
  }, [plans]);

  const persistPlans = useCallback(
    (nextPlans: AutoTagPlan[]) => {
      if (!token) return;
      setItem(PLAN_CACHE_KEY, nextPlans, token).catch((err) =>
        console.error('Failed to persist auto tag plans', err),
      );
    },
    [token],
  );

  const buildPlanForProject = useCallback(
    async (project: any, branchName: string): Promise<AutoTagPlan> => {
      if (!token) {
        throw new Error('请先在系统配置中设置 GitLab Token');
      }

      try {
        const creatorEmail = currentUser?.email;
        const branchInfo = await getProjectBranch(
          project.id,
          branchName,
          token,
        );
        const headCommit = branchInfo?.commit;
        if (!headCommit) {
          throw new Error(`未能解析 ${branchName} 最新提交`);
        }
        const commitDateLabel = formatDateLabel(
          headCommit.committed_date ||
            headCommit.created_at ||
            new Date().toISOString(),
        );
        const tags = await getProjectTags(project.id, token, { per_page: 1 });
        const latestTag =
          Array.isArray(tags) && tags.length > 0 ? tags[0] : undefined;
        let compareCommits: any[] = [];
        if (latestTag) {
          const compareResult = await compareProjectRefs(
            project.id,
            latestTag.name,
            headCommit.id,
            token,
          );
          compareCommits = compareResult?.commits || [];
        } else {
          compareCommits = await listProjectCommits(
            project.id,
            token,
            branchName,
            100,
          );
        }
        const sortedCommits = (compareCommits || [])
          .slice()
          .sort(
            (a, b) =>
              new Date(a.committed_date || a.created_at || '').getTime() -
              new Date(b.committed_date || b.created_at || '').getTime(),
          );

        const seenSubjects = new Set<string>();
        const entries: CommitEntry[] = [];
        let hasFix = false;
        let hasFeat = false;

        sortedCommits.forEach((commit) => {
          const subject = (commit.title || commit.message || '').trim();
          if (!subject) {
            return;
          }
          const lower = subject.toLowerCase();
          const isFix = lower.startsWith('fix:');
          const isFeat = lower.startsWith('feat:');
          if (!isFix && !isFeat) {
            return;
          }
          if (isFix) {
            hasFix = true;
          }
          if (isFeat) {
            hasFeat = true;
          }
          if (seenSubjects.has(subject)) {
            return;
          }
          seenSubjects.add(subject);
          entries.push({
            title: subject,
            sha: commit.id,
            webUrl:
              commit.web_url || `${project.web_url}/-/commit/${commit.id}`,
          });
        });

        const basePlan: AutoTagPlan = {
          projectId: project.id,
          projectLabel: project.name_with_namespace || project.name,
          projectWebUrl: project.web_url,
          branch: branchName,
          latestTag: latestTag?.name,
          rangeFrom: latestTag?.name || '仓库初始',
          headCommitSha: headCommit.id,
          commitDateLabel,
          tagName: '',
          tagMessage: '',
          entries,
          status: 'pending',
          detail: '',
        };

        if (entries.length === 0) {
          return {
            ...basePlan,
            status: 'failed',
            detail: '没有以 fix: 或 feat: 开头的提交',
          };
        }

        const tagType: TagType = hasFix && !hasFeat ? 'Hotfix' : 'Tag';
        const tagName = `${tagType}-${commitDateLabel}`;
        const body = entries
          .map((entry, index) => `${index + 1}. ${entry.title}`)
          .join('\n');
        let tagMessage = `Auto-generated tag for ${branchName} ${commitDateLabel}`;
        if (body) {
          tagMessage += `\n\n${body}`;
        }
        if (creatorEmail) {
          tagMessage += `\n\nCreator: ${creatorEmail}`;
        }

        return {
          ...basePlan,
          tagName,
          tagType,
          tagMessage,
          status: 'pending',
          detail: `共匹配 ${entries.length} 个提交`,
        };
      } catch (error: any) {
        return {
          projectId: project.id,
          projectLabel: project.name_with_namespace || project.name,
          projectWebUrl: project.web_url,
          branch: branchName,
          latestTag: undefined,
          rangeFrom: undefined,
          headCommitSha: '',
          commitDateLabel: '',
          tagName: '',
          tagMessage: '',
          entries: [],
          status: 'failed',
          detail: error?.message || '生成计划失败',
        };
      }
    },
    [token, currentUser?.email],
  );

  const handlePreview = async () => {
    try {
      const values = await form.validateFields();
      if (!token) {
        messageApi.warning('请先在系统配置中设置 GitLab Token');
        return;
      }
      const projectIds: number[] = values.projectIds || [];
      if (projectIds.length === 0) {
        messageApi.warning('请至少选择一个项目');
        return;
      }
      const branchName =
        values.targetBranch ||
        branchFromModel ||
        allProjects[0]?.default_branch ||
        'release';
      setLoadingPreview(true);
      const nextPlans: AutoTagPlan[] = [];
      // 顺序执行，避免对 GitLab 接口造成瞬时高压
      // eslint-disable-next-line no-restricted-syntax
      for (const projectId of projectIds) {
        const project = allProjects.find((item: any) => item.id === projectId);
        if (!project) {
          // eslint-disable-next-line no-continue
          continue;
        }
        // eslint-disable-next-line no-await-in-loop
        const plan = await buildPlanForProject(project, branchName);
        nextPlans.push(plan);
      }
      setPlans(nextPlans);
      setSelectedRowKeys(
        nextPlans
          .filter((plan) => plan.status !== 'success')
          .map((plan) => plan.projectId),
      );
      persistPlans(nextPlans);
      const pendingCount = nextPlans.filter(
        (plan) => plan.status !== 'success',
      ).length;
      if (pendingCount === 0) {
        messageApi.info('没有可执行的 Tag 计划，检查匹配的 fix/feat 提交');
      } else {
        messageApi.success(`生成 ${pendingCount} 个可执行的 Tag 计划`);
      }
    } catch (error: any) {
      if (error?.errorFields) {
        return;
      }
      messageApi.error(error?.message || '生成计划失败');
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleCreateTag = async (plan: AutoTagPlan) => {
    if (!token) {
      messageApi.warning('请先在系统配置中设置 GitLab Token');
      return;
    }
    setPlans((prev) => {
      const next = prev.map((item) =>
        item.projectId === plan.projectId
          ? { ...item, status: 'pending', detail: '执行中...' }
          : item,
      );
      persistPlans(next);
      return next;
    });
    try {
      let exist = false;
      try {
        await getProjectTag(plan.projectId, plan.tagName, token);
        exist = true;
      } catch (error: any) {
        const status = error?.response?.status || error?.response?.statusCode;
        if (status !== 404) {
          throw error;
        }
      }
      if (exist) {
        throw new Error(`标签 ${plan.tagName} 已存在`);
      }
      await createProjectTag(plan.projectId, token, {
        tag_name: plan.tagName,
        ref: plan.headCommitSha,
        message: plan.tagMessage,
      });
      setPlans((prev) => {
        const next = prev.map((item) =>
          item.projectId === plan.projectId
            ? {
                ...item,
                status: 'success',
                detail: '已创建并推送至远端',
                creatorEmail: currentUser?.email,
                finishedAt: new Date().toISOString(),
              }
            : item,
        );
        persistPlans(next);
        return next;
      });
      messageApi.success(`${plan.projectLabel} 已创建 ${plan.tagName}`);
    } catch (error: any) {
      const msg = error?.data?.message || error?.message || '创建失败';
      setPlans((prev) => {
        const next = prev.map((item) =>
          item.projectId === plan.projectId
            ? { ...item, status: 'failed', detail: msg }
            : item,
        );
        persistPlans(next);
        return next;
      });
      messageApi.error(`${plan.projectLabel}: ${msg}`);
    }
  };

  const executeBatch = async (candidates: AutoTagPlan[]) => {
    setBatchSubmitting(true);
    try {
      // eslint-disable-next-line no-restricted-syntax
      for (const plan of candidates) {
        // eslint-disable-next-line no-await-in-loop
        await handleCreateTag(plan);
      }
    } finally {
      setBatchSubmitting(false);
    }
  };

  const handleBatchCreate = () => {
    const selectedPlans = plans.filter(
      (plan) =>
        selectedRowKeys.includes(plan.projectId) && plan.status !== 'success',
    );
    if (selectedPlans.length === 0) {
      messageApi.info('请选择需要执行的计划');
      return;
    }
    Modal.confirm({
      title: '确认批量创建 Tag',
      content: (
        <div>
          <p>将对以下 {selectedPlans.length} 个任务执行标签创建：</p>
          <ol style={{ paddingLeft: 16 }}>
            {selectedPlans.map((plan) => (
              <li key={plan.projectId}>
                {plan.projectLabel}{' '}
                <Text type="secondary">
                  ({plan.tagName || '-'}, 当前状态：
                  {plan.status === 'success' ? '已成功' : '待执行/失败'})
                </Text>
              </li>
            ))}
          </ol>
        </div>
      ),
      okText: '确认执行',
      cancelText: '取消',
      onOk: () => executeBatch(selectedPlans),
    });
  };

  const columns: ColumnsType<AutoTagPlan> = [
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
      dataIndex: 'branch',
    },
    {
      title: '最新 Tag',
      dataIndex: 'latestTag',
      render: (value?: string) => value || '-',
    },
    {
      title: '提交匹配数',
      dataIndex: 'entries',
      render: (entries: CommitEntry[]) => entries.length,
    },
    {
      title: '建议 Tag',
      dataIndex: 'tagName',
      render: (_: string, record) =>
        record.tagName ? (
          <Space>
            <Tag color={record.tagType === 'Hotfix' ? 'red' : 'blue'}>
              {record.tagType}
            </Tag>
            <Text code>{record.tagName}</Text>
          </Space>
        ) : (
          '-'
        ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      render: (status: PlanStatus, record) => {
        const textMap: Record<PlanStatus, string> = {
          pending: '待执行',
          success: '已完成',
          failed: '执行失败',
        };
        return (
          <Space direction="vertical" size={0}>
            <Text>{textMap[status]}</Text>
            {record.detail && (
              <Text type={status === 'failed' ? 'danger' : 'secondary'}>
                {record.detail}
              </Text>
            )}
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
          disabled={record.status === 'success'}
          onClick={() => handleCreateTag(record)}
        >
          创建 Tag
        </Button>
      ),
    },
  ];

  return (
    <PageContainer>
      {contextHolder}
      {!token && (
        <Alert
          type="warning"
          showIcon
          title="请先在系统配置中配置 GitLab 实例地址和 Token"
          style={{ marginBottom: 24 }}
        />
      )}
      <Spin spinning={!init}>
        <Card title="选择项目生成 Tag 计划" variant="outlined">
          <Form
            layout="vertical"
            form={form}
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
                placeholder="不选择则默认展示所有已缓存的项目"
                options={groupOptions}
                showSearch
                optionFilterProp="label"
              />
            </Form.Item>
            <Form.Item
              label="项目"
              name="projectIds"
              rules={[{ required: true, message: '请选择需要打 Tag 的项目' }]}
            >
              <Select
                mode="multiple"
                allowClear
                placeholder="搜索项目名称或路径"
                options={projectOptions}
                showSearch
                optionFilterProp="label"
                filterOption={(input, option) =>
                  ((option?.label as string) || '')
                    .toLowerCase()
                    .includes(input.toLowerCase())
                }
              />
            </Form.Item>
            <Form.Item
              label="目标分支"
              name="targetBranch"
              tooltip="默认使用 release 分支，必要时可手动指定"
            >
              <Input placeholder="release" />
            </Form.Item>
            <Form.Item>
              <Space>
                <Button
                  type="primary"
                  onClick={handlePreview}
                  loading={loadingPreview}
                >
                  生成 Tag 计划
                </Button>
                <Button
                  onClick={() => {
                    form.resetFields();
                    setGroupFilter([]);
                    setPlans([]);
                    persistPlans([]);
                    setSelectedRowKeys([]);
                    form.setFieldsValue({
                      targetBranch: branchFromModel || 'release',
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
            title="提示"
            description="不会拉取本地仓库，所有操作均通过 GitLab REST API 执行。生成计划后，可逐项检查并创建 Tag。"
          />
        </Card>
        <Card
          title="执行计划"
          style={{ marginTop: 24 }}
          extra={
            <Button
              type="primary"
              disabled={!hasSelectablePlan}
              loading={batchSubmitting}
              onClick={handleBatchCreate}
            >
              批量创建未执行
            </Button>
          }
        >
          <Table
            columns={columns}
            dataSource={plans}
            rowKey="projectId"
            rowSelection={rowSelection}
            pagination={false}
            expandable={{
              expandedRowRender: (record) => (
                <div>
                  {record.entries.length > 0 ? (
                    <>
                      <Paragraph style={{ marginTop: 12 }}>
                        <Text strong>Tag Message</Text>
                        <pre style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>
                          {record.tagMessage || '-'}
                        </pre>
                      </Paragraph>
                    </>
                  ) : (
                    <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                      {record.detail || '暂无详情'}
                    </Paragraph>
                  )}
                </div>
              ),
            }}
            locale={{
              emptyText: loadingPreview ? '生成中...' : '请先生成 Tag 计划',
            }}
          />
        </Card>
      </Spin>
    </PageContainer>
  );
};

export default AutoTagPage;
