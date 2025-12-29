import { SettingFilled } from '@ant-design/icons';
import { Link } from '@umijs/max';

export default function FixSettingBtn() {
  return (
    <Link to={'/settings'}>
      <div className="fixed rounded-l-lg end-0 top-[224px] text-white bg-[#e24329] py-2 px-4 cursor-pointer">
        <SettingFilled />
      </div>
    </Link>
  );
}
