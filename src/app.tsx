import logoImg from '@/assets/logo.svg';
import { defaultFooterDom } from '@/layouts/Footer';
import { menuFooterRender } from '@/layouts/menuFooterRender';
import FixSettingBtn from '@/layouts/Setting';

// 运行时配置

// 全局初始化数据配置，用于 Layout 用户信息和权限初始化
// 更多信息见文档：https://umijs.org/docs/api/runtime-config#getinitialstate
export async function getInitialState(): Promise<{
  name: string;
  avatar: string;
}> {
  return {
    name: 'Gitlab Tools',
    avatar: logoImg,
  };
}

export const layout = () => {
  return {
    logo: logoImg,
    footerRender: () => defaultFooterDom,
    menuFooterRender: menuFooterRender,
    childrenRender: (children: any) => {
      return (
        <>
          {children}
          <FixSettingBtn />
        </>
      );
    },
    menu: {
      locale: false,
    },
  };
};
