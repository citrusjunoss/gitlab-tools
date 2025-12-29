import { SettingOutlined } from '@ant-design/icons';
import { Link } from '@umijs/max';

export function menuFooterRender() {
  return (
    <div className="flex items-center justify-center w-full">
      <Link to="">
        <SettingOutlined className="cursor-pointer text-[20px] hover:text-blue-500" />
        123123
      </Link>
    </div>
  );
}
