const routes: any[] = [
  // user
  {
    path: '/',
    component: '@/pages/index.tsx',
    icon: 'Home',
    name: '引导',
  },
  {
    path: '/search',
    component: '@/pages/search/index.tsx',
    icon: 'Search',
    name: '全局搜索',
  },
  {
    path: '/settings',
    component: '@/pages/Settings/index.tsx',
    icon: 'Setting',
    name: '系统配置',
    hideInMenu: true,
  },
  {
    path: '/nav',
    component: '@/pages/nav/index.tsx',
    icon: 'Appstore',
    name: '工具导航',
  },
  {
    path: '/auto-tag',
    component: '@/pages/auto-tag/index.tsx',
    icon: 'Tag',
    name: 'Auto Tag',
    hideInMenu: true,
  },
  {
    path: '/auto-update-dep',
    component: '@/pages/auto-update-dep/index.tsx',
    icon: 'CloudSync',
    name: '依赖自动更新',
    hideInMenu: true,
  },
  {
    path: '/branch-cleanup',
    component: '@/pages/branch-cleanup/index.tsx',
    icon: 'Branches',
    name: '分支清理',
    hideInMenu: true,
  },
];

export default routes;
