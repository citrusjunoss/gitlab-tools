import { GitlabModelState } from '@/models/gitlabModel';
import { SearchOutlined } from '@ant-design/icons';
import { Button, Col, Form, Input, Row, Select, Switch } from 'antd';
import React, { useEffect } from 'react';

interface Props {
  allGroups: Array<any>;
  keyword: string;
  branch: string;
  selectGroups: Array<string>;
  includePattern: string;
  excludePattern: string;
  selectGroups1: string;
  isExact: boolean;
  searchHandle: (p: any) => void;
  updateState: (state: Partial<GitlabModelState>) => void;
}

const SearchConditionForm: React.FunctionComponent<Props> = ({
  allGroups,
  keyword,
  branch,
  selectGroups,
  selectGroups1,
  isExact,
  searchHandle,
  updateState,
}) => {
  const [form] = Form.useForm();

  useEffect(() => {
    form.setFieldsValue({
      keyword,
      branch,
      selectGroups,
      selectGroups1,
    });
  }, [keyword, branch, selectGroups, selectGroups1]);

  const onFinish = (values: any) => {
    searchHandle(values);
  };

  const onReset = () => {
    form.resetFields();
    updateState({
      keyword: '',
      branch: '',
      selectGroups: [],
      selectGroups1: '',
      includePattern: '',
      excludePattern: '',
    });
  };

  const onValuesChange = (changedValues: any) => {
    updateState(changedValues);
  };

  const onChange = (checked: boolean) => {
    updateState({ isExact: checked });
  };

  return (
    <Form
      colon={false}
      name="searchOptions"
      onFinish={onFinish}
      onValuesChange={onValuesChange}
      form={form}
      labelAlign="left"
    >
      <Row gutter={24}>
        <Col span={8}>
          <Form.Item label="关键字" name="keyword" rules={[{ required: true }]}>
            <Input placeholder="请输入搜索关键字" allowClear />
          </Form.Item>
        </Col>
        <Col span={8}>
          {isExact ? (
            <Form.Item label="群组" name="selectGroups">
              <Select
                showSearch
                mode="multiple"
                allowClear
                placeholder="请选择系统group，不选默认全局"
                filterOption={(input, option) =>
                  (option?.children as any)
                    .toLowerCase()
                    .indexOf(input.toLowerCase()) >= 0
                }
              >
                {allGroups.length &&
                  allGroups.map((group) => (
                    <Select.Option key={group.id} value={group.id}>
                      {group.full_path}
                    </Select.Option>
                  ))}
              </Select>
            </Form.Item>
          ) : (
            <Form.Item label="群组" name="selectGroups1">
              <Input placeholder="请输入搜索关键字" allowClear />
            </Form.Item>
          )}
        </Col>
        <Col span={8}>
          <Form.Item label="分支/标签" name="branch">
            <Input placeholder="默认为项目的默认分支" allowClear />
          </Form.Item>
        </Col>
      </Row>
      <Row gutter={24}>
        <Col span={24}>
          <Switch
            checkedChildren="精确群组"
            unCheckedChildren="模糊群组"
            style={{ marginRight: 20 }}
            checked={isExact}
            onChange={onChange}
          />
          <Button
            type="primary"
            htmlType="submit"
            style={{ marginRight: 20 }}
            icon={<SearchOutlined />}
          >
            搜索
          </Button>
          <Button htmlType="button" onClick={onReset}>
            重置
          </Button>
        </Col>
      </Row>
    </Form>
  );
};

export default SearchConditionForm;
