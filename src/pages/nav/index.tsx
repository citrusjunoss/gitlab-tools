import {
  BranchesOutlined,
  CloudSyncOutlined,
  TagOutlined,
} from '@ant-design/icons';
import { PageContainer, ProCard } from '@ant-design/pro-components';
import { history } from '@umijs/max';

const NavPage: React.FC = () => {
  return (
    <PageContainer title={false}>
      <ProCard ghost gutter={[16, 16]} wrap style={{ marginTop: 24 }}>
        <ProCard
          colSpan={{ xs: 24, sm: 12, md: 8, lg: 6 }}
          layout="center"
          variant="outlined"
          hoverable
          onClick={() => {
            history.push('/auto-tag');
          }}
          style={{ height: 180, borderRadius: 12, cursor: 'pointer' }}
        >
          <div style={{ textAlign: 'center' }}>
            <TagOutlined
              style={{ fontSize: 40, color: '#1890ff', marginBottom: 12 }}
            />
            <div style={{ fontSize: 16, fontWeight: 600, color: '#333' }}>
              Auto Tag
            </div>
            <div style={{ color: '#666', marginTop: 4, fontSize: 12 }}>
              自动打 Tag 工具
            </div>
          </div>
        </ProCard>

        <ProCard
          colSpan={{ xs: 24, sm: 12, md: 8, lg: 6 }}
          layout="center"
          variant="outlined"
          hoverable
          onClick={() => {
            history.push('/auto-update-dep');
          }}
          style={{ height: 180, borderRadius: 12, cursor: 'pointer' }}
        >
          <div style={{ textAlign: 'center' }}>
            <CloudSyncOutlined
              style={{ fontSize: 40, color: '#52c41a', marginBottom: 12 }}
            />
            <div style={{ fontSize: 16, fontWeight: 600, color: '#333' }}>
              Auto Update Dep
            </div>
            <div style={{ color: '#666', marginTop: 4, fontSize: 12 }}>
              依赖自动更新工具
            </div>
          </div>
        </ProCard>

        <ProCard
          colSpan={{ xs: 24, sm: 12, md: 8, lg: 6 }}
          layout="center"
          variant="outlined"
          hoverable
          onClick={() => {
            history.push('/branch-cleanup');
          }}
          style={{ height: 180, borderRadius: 12, cursor: 'pointer' }}
        >
          <div style={{ textAlign: 'center' }}>
            <BranchesOutlined
              style={{ fontSize: 40, color: '#fa8c16', marginBottom: 12 }}
            />
            <div style={{ fontSize: 16, fontWeight: 600, color: '#333' }}>
              分支清理
            </div>
            <div style={{ color: '#666', marginTop: 4, fontSize: 12 }}>
              批量删除过时分支
            </div>
          </div>
        </ProCard>
      </ProCard>
    </PageContainer>
  );
};

export default NavPage;
