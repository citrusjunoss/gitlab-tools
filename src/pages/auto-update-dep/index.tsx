import {
  createProjectBranch,
  createProjectMergeRequest,
  getProjectBranch,
  getRepositoryFile,
  listProjectMergeRequests,
  updateRepositoryFile,
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

type DepUpdateStatus = 'pending' | 'success' | 'failed' | 'skipped';
type DependencyField =
  | 'dependencies'
  | 'devDependencies'
  | 'peerDependencies'
  | 'optionalDependencies';

interface PackageJsonLike {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  [key: string]: any;
}

interface DependencyMatchResult {
  field?: DependencyField;
  version?: string;
}

interface DepUpdatePlan {
  projectId: number;
  projectLabel: string;
  projectWebUrl: string;
  targetBranch: string;
  sourceBranch: string;
  packageJsonPath: string;
  dependencyName: string;
  currentVersion?: string;
  targetVersion: string;
  matchedField?: DependencyField;
  status: DepUpdateStatus;
  detail: string;
  mrUrl?: string;
  beforeSnippet?: string;
  afterSnippet?: string;
}

const DEP_FIELDS: DependencyField[] = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
];

const PLAN_CACHE_KEY = 'autoUpdateDepPlans';
const PACKAGE_JSON_PATH = 'package.json';
const TOOL_NAME = 'Gitlab Tools / Auto Update Dep';

const { Paragraph, Text, Link } = Typography;

const sanitizeBranchSegment = (value: string) => {
  const normalized = value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-');
  return normalized.replace(/-+/g, '-').replace(/^-|-$/g, '') || 'unknown';
};

const buildSourceBranch = (dependencyName: string, targetVersion: string) => {
  return `chore/update-${sanitizeBranchSegment(
    dependencyName,
  )}-to-${sanitizeBranchSegment(targetVersion)}`;
};

const decodeBase64Content = (value?: string) => {
  if (!value) return '';
  try {
    return decodeURIComponent(escape(window.atob(value)));
  } catch (error) {
    return window.atob(value);
  }
};

const stringifyPackageJson = (pkg: PackageJsonLike) =>
  `${JSON.stringify(pkg, null, 2)}\n`;

const buildSnippet = (
  field: DependencyField | undefined,
  dependencyName: string,
  version: string | undefined,
) => {
  if (!field || !version) {
    return '-';
  }
  return `"${field}": { "${dependencyName}": "${version}" }`;
};

const findDependencyVersion = (
  pkg: PackageJsonLike,
  dependencyName: string,
): DependencyMatchResult => {
  for (const field of DEP_FIELDS) {
    const deps = pkg[field];
    if (deps && typeof deps === 'object' && dependencyName in deps) {
      return {
        field,
        version: deps[dependencyName],
      };
    }
  }
  return {};
};

const updateDependencyVersion = (
  pkg: PackageJsonLike,
  dependencyName: string,
  targetVersion: string,
) => {
  const nextPkg: PackageJsonLike = JSON.parse(JSON.stringify(pkg));
  const match = findDependencyVersion(nextPkg, dependencyName);
  if (!match.field || !match.version) {
    return {
      changed: false,
      pkg: nextPkg,
      field: undefined,
      previousVersion: undefined,
    };
  }
  nextPkg[match.field] = {
    ...nextPkg[match.field],
    [dependencyName]: targetVersion,
  };
  return {
    changed: match.version !== targetVersion,
    pkg: nextPkg,
    field: match.field,
    previousVersion: match.version,
  };
};

const buildMrDescription = (plan: DepUpdatePlan) => {
  const executedAt = new Date().toLocaleString('zh-CN', {
    hour12: false,
  });
  return [
    `- 更新依赖：${plan.dependencyName}`,
    `- 目标版本：${plan.targetVersion}`,
    `- 原版本：${plan.currentVersion || '-'}`,
    `- 执行工具：${TOOL_NAME}`,
    `- 执行时间：${executedAt}`,
  ].join('\n');
};

const getErrorStatus = (error: any) =>
  error?.response?.status || error?.response?.statusCode || error?.data?.status;

const getErrorMessage = (error: any, fallback: string) => {
  const detail =
    error?.data?.message ||
    error?.response?.data?.message ||
    error?.message ||
    fallback;
  return typeof detail === 'string' ? detail : fallback;
};

const AutoUpdateDepPage: React.FC = () => {
  const {
    token,
    branch: branchFromModel,
    allProjects,
    allGroups,
    init,
    fetchAllGroups,
  } = useModel('gitlabModel');
  const [form] = Form.useForm();
  const [groupFilter, setGroupFilter] = useState<number[]>([]);
  const [plans, setPlans] = useState<DepUpdatePlan[]>([]);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [batchSubmitting, setBatchSubmitting] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([]);
  const [messageApi, contextHolder] = message.useMessage();

  useEffect(() => {
    if (token && allGroups.length === 0) {
      fetchAllGroups();
    }
  }, [token, allGroups.length, fetchAllGroups]);

  useEffect(() => {
    form.setFieldsValue({
      targetBranch: branchFromModel || 'release',
    });
  }, [branchFromModel, form]);

  useEffect(() => {
    const loadCachedPlans = async () => {
      if (!token) {
        setPlans([]);
        setSelectedRowKeys([]);
        return;
      }
      const cachedPlans = await getItem<DepUpdatePlan[]>(PLAN_CACHE_KEY, token);
      if (cachedPlans && cachedPlans.length > 0) {
        setPlans(cachedPlans);
        setSelectedRowKeys(
          cachedPlans
            .filter(
              (plan) => plan.status === 'pending' || plan.status === 'failed',
            )
            .map((plan) => plan.projectId),
        );
      }
    };
    loadCachedPlans();
  }, [token]);

  const persistPlans = useCallback(
    (nextPlans: DepUpdatePlan[]) => {
      if (!token) return;
      setItem(PLAN_CACHE_KEY, nextPlans, token).catch((error) => {
        console.error('Failed to persist auto update dep plans', error);
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
    }));
  }, [allProjects, groupFilter]);

  const hasSelectablePlan = selectedRowKeys.length > 0;

  const rowSelection = {
    selectedRowKeys,
    onChange: (keys: React.Key[]) => {
      const valid = (keys as number[]).filter((key) => {
        const plan = plans.find((item) => item.projectId === key);
        return plan && (plan.status === 'pending' || plan.status === 'failed');
      });
      setSelectedRowKeys(valid);
    },
    getCheckboxProps: (record: DepUpdatePlan) => ({
      disabled: !['pending', 'failed'].includes(record.status),
    }),
  };

  useEffect(() => {
    setSelectedRowKeys((prev) =>
      prev.filter((key) => {
        const plan = plans.find((item) => item.projectId === key);
        return plan && ['pending', 'failed'].includes(plan.status);
      }),
    );
  }, [plans]);

  const buildPlanForProject = useCallback(
    async (
      project: any,
      targetBranch: string,
      dependencyName: string,
      targetVersion: string,
    ): Promise<DepUpdatePlan> => {
      const basePlan: DepUpdatePlan = {
        projectId: project.id,
        projectLabel: project.name_with_namespace || project.name,
        projectWebUrl: project.web_url,
        targetBranch,
        sourceBranch: buildSourceBranch(dependencyName, targetVersion),
        packageJsonPath: PACKAGE_JSON_PATH,
        dependencyName,
        targetVersion,
        status: 'failed',
        detail: '',
      };

      if (!token) {
        return {
          ...basePlan,
          detail: '请先在系统配置中设置 GitLab Token',
        };
      }

      try {
        await getProjectBranch(project.id, targetBranch, token);
      } catch (error: any) {
        return {
          ...basePlan,
          status: 'failed',
          detail:
            getErrorStatus(error) === 404
              ? `目标分支 ${targetBranch} 不存在`
              : getErrorMessage(error, '读取目标分支失败'),
        };
      }

      try {
        const file = await getRepositoryFile(
          project.id,
          PACKAGE_JSON_PATH,
          targetBranch,
          token,
        );
        const content = decodeBase64Content(file?.content);
        const parsed = JSON.parse(content) as PackageJsonLike;
        const match = findDependencyVersion(parsed, dependencyName);

        if (!match.field || !match.version) {
          return {
            ...basePlan,
            status: 'skipped',
            detail: `未在 package.json 中找到依赖 ${dependencyName}`,
          };
        }

        if (match.version === targetVersion) {
          return {
            ...basePlan,
            currentVersion: match.version,
            matchedField: match.field,
            beforeSnippet: buildSnippet(
              match.field,
              dependencyName,
              match.version,
            ),
            afterSnippet: buildSnippet(
              match.field,
              dependencyName,
              targetVersion,
            ),
            status: 'skipped',
            detail: '当前版本已是目标版本',
          };
        }

        return {
          ...basePlan,
          currentVersion: match.version,
          matchedField: match.field,
          beforeSnippet: buildSnippet(
            match.field,
            dependencyName,
            match.version,
          ),
          afterSnippet: buildSnippet(
            match.field,
            dependencyName,
            targetVersion,
          ),
          status: 'pending',
          detail: `将在 ${match.field} 中更新 ${dependencyName}`,
        };
      } catch (error: any) {
        const status = getErrorStatus(error);
        return {
          ...basePlan,
          status: 'failed',
          detail:
            status === 404
              ? '根目录不存在 package.json'
              : status === 400
              ? 'package.json 内容非法'
              : getErrorMessage(error, '读取 package.json 失败'),
        };
      }
    },
    [token],
  );

  const updatePlanStatus = useCallback(
    (projectId: number, updater: (plan: DepUpdatePlan) => DepUpdatePlan) => {
      setPlans((prev) => {
        const next = prev.map((item) =>
          item.projectId === projectId ? updater(item) : item,
        );
        persistPlans(next);
        return next;
      });
    },
    [persistPlans],
  );

  const executePlan = useCallback(
    async (plan: DepUpdatePlan) => {
      if (!token) {
        messageApi.warning('请先在系统配置中设置 GitLab Token');
        return;
      }

      updatePlanStatus(plan.projectId, (item) => ({
        ...item,
        detail: '执行中...',
      }));

      try {
        const commitMessage = `chore: update ${plan.dependencyName} to ${plan.targetVersion}`;

        try {
          await getProjectBranch(plan.projectId, plan.sourceBranch, token);
        } catch (error: any) {
          const status = getErrorStatus(error);
          if (status !== 404) {
            throw error;
          }
          await createProjectBranch(
            plan.projectId,
            plan.sourceBranch,
            plan.targetBranch,
            token,
          );
        }

        const file = await getRepositoryFile(
          plan.projectId,
          plan.packageJsonPath,
          plan.sourceBranch,
          token,
        );
        const currentContent = decodeBase64Content(file?.content);
        const parsed = JSON.parse(currentContent) as PackageJsonLike;
        const updateResult = updateDependencyVersion(
          parsed,
          plan.dependencyName,
          plan.targetVersion,
        );

        if (!updateResult.field || !updateResult.previousVersion) {
          updatePlanStatus(plan.projectId, (item) => ({
            ...item,
            status: 'skipped',
            detail: `分支 ${plan.sourceBranch} 上未找到依赖 ${plan.dependencyName}`,
          }));
          return;
        }

        if (updateResult.previousVersion !== plan.targetVersion) {
          await updateRepositoryFile(
            plan.projectId,
            plan.packageJsonPath,
            plan.sourceBranch,
            stringifyPackageJson(updateResult.pkg),
            commitMessage,
            token,
          );
        }

        const existingMrs = await listProjectMergeRequests(
          plan.projectId,
          token,
          {
            state: 'opened',
            source_branch: plan.sourceBranch,
            target_branch: plan.targetBranch,
          },
        );
        const existMr = Array.isArray(existingMrs) ? existingMrs[0] : undefined;

        if (existMr) {
          updatePlanStatus(plan.projectId, (item) => ({
            ...item,
            currentVersion: updateResult.previousVersion,
            matchedField: updateResult.field,
            beforeSnippet: buildSnippet(
              updateResult.field,
              plan.dependencyName,
              updateResult.previousVersion,
            ),
            afterSnippet: buildSnippet(
              updateResult.field,
              plan.dependencyName,
              plan.targetVersion,
            ),
            mrUrl: existMr.web_url,
            status: 'success',
            detail: '已复用现有 MR',
          }));
          messageApi.success(`${plan.projectLabel} 已复用现有 MR`);
          return;
        }

        const createdMr = await createProjectMergeRequest(
          plan.projectId,
          token,
          {
            source_branch: plan.sourceBranch,
            target_branch: plan.targetBranch,
            title: commitMessage,
            description: buildMrDescription({
              ...plan,
              currentVersion: updateResult.previousVersion,
            }),
          },
        );

        updatePlanStatus(plan.projectId, (item) => ({
          ...item,
          currentVersion: updateResult.previousVersion,
          matchedField: updateResult.field,
          beforeSnippet: buildSnippet(
            updateResult.field,
            plan.dependencyName,
            updateResult.previousVersion,
          ),
          afterSnippet: buildSnippet(
            updateResult.field,
            plan.dependencyName,
            plan.targetVersion,
          ),
          mrUrl: createdMr?.web_url,
          status: 'success',
          detail: '已创建更新分支并发起 MR',
        }));
        messageApi.success(`${plan.projectLabel} 已创建 MR`);
      } catch (error: any) {
        const detail = getErrorMessage(error, '执行依赖更新失败');
        updatePlanStatus(plan.projectId, (item) => ({
          ...item,
          status: 'failed',
          detail,
        }));
        messageApi.error(`${plan.projectLabel}: ${detail}`);
      }
    },
    [messageApi, token, updatePlanStatus],
  );

  const handlePreview = async () => {
    try {
      const values = await form.validateFields();
      if (!token) {
        messageApi.warning('请先在系统配置中设置 GitLab Token');
        return;
      }
      const projectIds: number[] = values.projectIds || [];
      const dependencyName = (values.dependencyName || '').trim();
      const targetVersion = (values.targetVersion || '').trim();
      const targetBranch =
        values.targetBranch ||
        branchFromModel ||
        allProjects[0]?.default_branch ||
        'release';

      setLoadingPreview(true);
      const nextPlans: DepUpdatePlan[] = [];
      for (const projectId of projectIds) {
        const project = allProjects.find((item: any) => item.id === projectId);
        if (!project) {
          continue;
        }
        const plan = await buildPlanForProject(
          project,
          targetBranch,
          dependencyName,
          targetVersion,
        );
        nextPlans.push(plan);
      }
      setPlans(nextPlans);
      setSelectedRowKeys(
        nextPlans
          .filter(
            (plan) => plan.status === 'pending' || plan.status === 'failed',
          )
          .map((plan) => plan.projectId),
      );
      persistPlans(nextPlans);

      const pendingCount = nextPlans.filter(
        (plan) => plan.status === 'pending',
      ).length;
      messageApi.success(
        pendingCount > 0
          ? `生成 ${pendingCount} 个可执行更新计划`
          : '计划生成完成，请检查跳过或失败项',
      );
    } catch (error: any) {
      if (error?.errorFields) {
        return;
      }
      messageApi.error(getErrorMessage(error, '生成计划失败'));
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleBatchExecute = async () => {
    const selectedPlans = plans.filter(
      (plan) =>
        selectedRowKeys.includes(plan.projectId) &&
        ['pending', 'failed'].includes(plan.status),
    );
    if (selectedPlans.length === 0) {
      messageApi.info('请选择需要执行的计划');
      return;
    }
    setBatchSubmitting(true);
    try {
      for (const plan of selectedPlans) {
        await executePlan(plan);
      }
    } finally {
      setBatchSubmitting(false);
    }
  };

  const columns: ColumnsType<DepUpdatePlan> = [
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
      title: '目标分支',
      dataIndex: 'targetBranch',
      width: 120,
    },
    {
      title: '依赖字段',
      dataIndex: 'matchedField',
      width: 150,
      render: (value?: DependencyField) => value || '-',
    },
    {
      title: '当前版本',
      dataIndex: 'currentVersion',
      width: 120,
      render: (value?: string) => value || '-',
    },
    {
      title: '目标版本',
      dataIndex: 'targetVersion',
      width: 120,
    },
    {
      title: '更新分支',
      dataIndex: 'sourceBranch',
      width: 220,
      render: (value: string) => <Text code>{value}</Text>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 180,
      render: (status: DepUpdateStatus, record) => {
        const colorMap: Record<DepUpdateStatus, string> = {
          pending: 'processing',
          success: 'success',
          failed: 'error',
          skipped: 'default',
        };
        const textMap: Record<DepUpdateStatus, string> = {
          pending: '待执行',
          success: '已完成',
          failed: '失败',
          skipped: '已跳过',
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
      width: 120,
      render: (_: any, record) => (
        <Button
          type="primary"
          size="small"
          disabled={!['pending', 'failed'].includes(record.status)}
          onClick={() => executePlan(record)}
        >
          执行更新
        </Button>
      ),
    },
  ];

  return (
    <PageContainer
      title="依赖自动更新"
      subTitle="手动指定依赖名和目标版本，批量为 GitLab 项目生成更新分支并创建 MR"
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
        <Card
          title="生成更新计划"
          variant="outlined"
          style={{
            borderRadius: 20,
            background:
              'linear-gradient(145deg, rgba(255,248,240,0.96), rgba(247,252,245,0.96))',
          }}
        >
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
              rules={[{ required: true, message: '请选择需要更新依赖的项目' }]}
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
              style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr' }}
            >
              <Form.Item
                label="目标分支"
                name="targetBranch"
                tooltip="默认使用 release 分支，可手动指定"
                style={{ marginBottom: 0 }}
              >
                <Input placeholder="release" />
              </Form.Item>
              <Form.Item
                label="依赖名"
                name="dependencyName"
                rules={[{ required: true, message: '请输入依赖名' }]}
                style={{ marginBottom: 0 }}
              >
                <Input placeholder="例如 react 或 @scope/pkg" />
              </Form.Item>
              <Form.Item
                label="目标版本"
                name="targetVersion"
                rules={[{ required: true, message: '请输入目标版本' }]}
                style={{ marginBottom: 0 }}
              >
                <Input placeholder="例如 ^18.3.1" />
              </Form.Item>
            </Space>
            <Form.Item style={{ marginTop: 24, marginBottom: 0 }}>
              <Space>
                <Button
                  type="primary"
                  onClick={handlePreview}
                  loading={loadingPreview}
                >
                  生成更新计划
                </Button>
                <Button
                  onClick={() => {
                    form.resetFields();
                    setGroupFilter([]);
                    setPlans([]);
                    setSelectedRowKeys([]);
                    persistPlans([]);
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
            style={{ marginTop: 20 }}
            message="本工具只更新根目录 package.json，不处理 lockfile。写操作会串行执行，并自动创建或复用 MR。"
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
              onClick={handleBatchExecute}
            >
              批量执行已选计划
            </Button>
          }
        >
          <Table
            rowKey="projectId"
            columns={columns}
            dataSource={plans}
            rowSelection={rowSelection}
            pagination={false}
            expandable={{
              expandedRowRender: (record) => (
                <div style={{ display: 'grid', gap: 12 }}>
                  <Paragraph style={{ marginBottom: 0 }}>
                    <Text strong>更新前</Text>
                    <pre style={{ whiteSpace: 'pre-wrap', margin: '6px 0 0' }}>
                      {record.beforeSnippet || '-'}
                    </pre>
                  </Paragraph>
                  <Paragraph style={{ marginBottom: 0 }}>
                    <Text strong>更新后</Text>
                    <pre style={{ whiteSpace: 'pre-wrap', margin: '6px 0 0' }}>
                      {record.afterSnippet || '-'}
                    </pre>
                  </Paragraph>
                  <Paragraph style={{ marginBottom: 0 }}>
                    <Text strong>MR</Text>{' '}
                    {record.mrUrl ? (
                      <Link href={record.mrUrl} target="_blank">
                        {record.mrUrl}
                      </Link>
                    ) : (
                      <Text type="secondary">尚未创建</Text>
                    )}
                  </Paragraph>
                </div>
              ),
            }}
            locale={{
              emptyText: loadingPreview ? '计划生成中...' : '请先生成更新计划',
            }}
          />
        </Card>
      </Spin>
    </PageContainer>
  );
};

export default AutoUpdateDepPage;
