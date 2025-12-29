import {
  getCurrentGitlabUser,
  getGitlabGroups,
  getGitlabProjects,
  searchCodeInProject,
} from '@/services/gitlab';
import { history } from '@umijs/max';
import { Modal } from 'antd';
import pLimit from 'p-limit';
import { useCallback, useEffect, useState } from 'react';
import { getItem, setItem } from '../utils/storage'; // 导入 storage 工具

export interface CodeResult {
  file_path: string;
  codeLines: number;
  startline: number;
  data: string;
  project: any;
  path: string; // 文件在项目中的相对路径
  ref: string; // 文件所在的分支或标签
}

export interface GitlabModelState {
  keyword: string;
  token: string;
  gitlabUrl: string;
  init: boolean;
  branch: string; // 分支或标签
  isExact: boolean;
  selectGroups: string[];
  selectGroups1: string;
  includePattern: string; // 包含文件 glob 规则
  excludePattern: string; // 排除文件 glob 规则
  projectTotal: number;
  projectSearched: number;
  allGroups: any[];
  allProjects: any[];
  currentUser: any | null;
  allGroupsNumber: number;
  allProjectsNumber: number;
  codeResult: CodeResult[];
  status: string;
  loading: boolean;
  concurrencyLimit: number; // 并发限制
  requestDelay: number; // 请求延迟
}

const useGitlabModel = () => {
  const [state, setState] = useState<GitlabModelState>({
    keyword: '',
    token: '',
    gitlabUrl: '',
    init: false,
    branch: 'release',
    isExact: false,
    projectTotal: 0,
    projectSearched: 0,
    selectGroups: [],
    selectGroups1: '',
    includePattern: '',
    excludePattern: '',
    allGroups: [],
    allProjects: [],
    currentUser: null,
    allGroupsNumber: 0,
    allProjectsNumber: 0,
    codeResult: [],
    status: '',
    loading: false,
    concurrencyLimit: 5, // 默认并发限制
    requestDelay: 1000, // 默认请求延迟
  });

  const updateState = useCallback((newState: Partial<GitlabModelState>) => {
    setState((prevState) => {
      let init = true;
      // 保存配置
      if (newState.concurrencyLimit !== undefined) {
        setItem('concurrencyLimit', newState.concurrencyLimit, 'global');
      }
      if (newState.requestDelay !== undefined) {
        setItem('requestDelay', newState.requestDelay, 'global');
      }
      if (newState.gitlabUrl !== undefined) {
        localStorage.setItem('gitlab_url', newState.gitlabUrl);
      }
      if (newState.token !== prevState.token && newState.token) {
        localStorage.setItem('gitlab_token', newState.token);
        init = false; // token 变化需要重新初始化
      }
      console.log('updateState', { ...prevState, ...newState, init });
      return { ...prevState, ...newState, init };
    });
  }, []);

  const fetchAllGroupsRemote = async () => {
    const token = localStorage.getItem('gitlab_token') || '';
    if (!token) return [];
    let allGroups: any[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const res = await getGitlabGroups(token, page); // 假设第二个参数是页码
      allGroups = allGroups.concat(res);
      if (res.length < 100) {
        hasMore = false;
      } else {
        page += 1;
      }
    }

    if (allGroups.length > 0) {
      await setItem('gitlabGroups', allGroups, token);
      updateState({ allGroups, allGroupsNumber: allGroups.length });
      return allGroups;
    }
    return [];
  };

  const fetchAllGroups = useCallback(async () => {
    const token = localStorage.getItem('gitlab_token') || '';
    if (!token) return [];
    const cachedGroups = await getItem<any[]>('gitlabGroups', token);
    if (cachedGroups && cachedGroups.length > 0) {
      updateState({
        allGroups: cachedGroups,
        allGroupsNumber: cachedGroups.length,
      });
      return cachedGroups;
    }
    return await fetchAllGroupsRemote();
  }, []);

  const fetchAllProjectsRemote = async () => {
    const limit = pLimit(state.concurrencyLimit); // 使用配置的并发限制
    const token = localStorage.getItem('gitlab_token') || '';
    const groups = state.allGroups;
    if (!token || !groups || groups.length === 0) return;
    const promises = groups.map((group) =>
      limit(async () => {
        let result = [];
        try {
          const res = await getGitlabProjects(group.id, token);
          if (res && res.length > 0) {
            result = res;
          }
        } catch (error) {}
        // eslint-disable-next-line no-promise-executor-return
        await new Promise((resolve) => setTimeout(resolve, state.requestDelay)); // 使用配置的请求延迟
        return result || [];
      }),
    );
    const results = await Promise.all(promises);
    const allProjects = results.flat(1);
    await setItem('gitlabProjects', allProjects, token);
    updateState({
      allProjects,
      allProjectsNumber: allProjects.length,
      init: true,
    });
  };

  const fetchAllProjects = useCallback(async () => {
    const token = localStorage.getItem('gitlab_token') || '';
    if (!token || !state.allGroups || state.allGroups.length === 0) return;
    const cachedProjects = await getItem<any[]>('gitlabProjects', token);
    if (cachedProjects && cachedProjects.length > 0) {
      updateState({
        allProjects: cachedProjects,
        allProjectsNumber: cachedProjects.length,
        init: true,
      });
      return;
    }
    await fetchAllProjectsRemote();
  }, [state.allGroups]);

  const fetchCurrentUserRemote = useCallback(async () => {
    const token = localStorage.getItem('gitlab_token') || '';
    if (!token) return null;
    try {
      const user = await getCurrentGitlabUser(token);
      if (user) {
        await setItem('gitlabCurrentUser', user, token);
        updateState({ currentUser: user });
      }
      return user;
    } catch (error) {
      console.error('Failed to fetch current user', error);
      return null;
    }
  }, [updateState]);

  const fetchCurrentUser = useCallback(async () => {
    const token = localStorage.getItem('gitlab_token') || '';
    if (!token) return null;
    const cachedUser = await getItem<any>('gitlabCurrentUser', token);
    if (cachedUser) {
      updateState({ currentUser: cachedUser });
      return cachedUser;
    }
    return await fetchCurrentUserRemote();
  }, [fetchCurrentUserRemote, updateState]);

  const search = useCallback(async () => {
    const {
      keyword,
      selectGroups,
      allProjects,
      isExact,
      selectGroups1,
      branch,
      concurrencyLimit, // 获取并发限制
      requestDelay, // 获取请求延迟
    } = state;
    const token = localStorage.getItem('gitlab_token') || '';
    if (!token || !keyword) {
      updateState({ status: '请输入 Token 或关键词' });
      return;
    }
    updateState({ loading: true, status: '搜索中...', codeResult: [] });
    let projectsToSearch = allProjects;
    if (selectGroups.length > 0 || selectGroups1) {
      projectsToSearch = allProjects.filter((p) => {
        const bool = isExact
          ? selectGroups.includes(p.namespace.id)
          : p.namespace.full_path.includes(selectGroups1);
        return bool;
      });
    }
    if (projectsToSearch.length === 0) {
      updateState({
        loading: false,
        status: '无匹配项目',
      });
      return;
    }
    updateState({ projectTotal: projectsToSearch.length, projectSearched: 0 });
    const limit = pLimit(concurrencyLimit); // 使用配置的并发限制
    let allResults: CodeResult[] = [];
    const promises = projectsToSearch.map((project) =>
      limit(async () => {
        try {
          const res = await searchCodeInProject(
            project.id,
            keyword,
            token,
            branch,
          );
          if (res && res.length > 0) {
            const handledResult = res.map((code: any) => ({
              ...code,
              project,
              path: code.path,
              ref: code.ref,
              codeLines: code.data.split(/\n/g).length - 1,
              file_path: `${project.path_with_namespace}/blob/${code.ref}/${code.path}`,
            }));
            allResults = allResults.concat(handledResult);
            updateState({ codeResult: [...allResults] });
          }
        } catch (error) {
          console.error(`Failed to search in project ${project.name}:`, error);
        }
        setState((prev) => ({
          ...prev,
          projectSearched: prev.projectSearched + 1,
        }));
        // eslint-disable-next-line no-promise-executor-return
        await new Promise((resolve) => setTimeout(resolve, requestDelay)); // 使用配置的请求延迟
      }),
    );
    await Promise.all(promises);
    updateState({ loading: false, status: `搜索完毕` });
  }, [state]);

  // 加载配置
  useEffect(() => {
    const loadSettings = async () => {
      const savedConcurrencyLimit = await getItem<number>(
        'concurrencyLimit',
        'global',
      );
      const savedRequestDelay = await getItem<number>('requestDelay', 'global');
      const gitlabToken = localStorage.getItem('gitlab_token') || '';
      const gitlabUrl = localStorage.getItem('gitlab_url') || '';
      const updates: Partial<GitlabModelState> = {};
      if (savedConcurrencyLimit !== null) {
        updates.concurrencyLimit = savedConcurrencyLimit;
      }
      if (savedRequestDelay !== null) {
        updates.requestDelay = savedRequestDelay;
      }

      if (gitlabUrl) {
        updates.gitlabUrl = gitlabUrl;
      }
      if (gitlabToken) {
        updates.token = gitlabToken;
      } else {
        console.log('no token found');
        updateState({ init: true });
      }
      if (Object.keys(updates).length > 0) {
        setState((prevState) => ({ ...prevState, ...updates }));
      }

      if (!gitlabToken || !gitlabUrl) {
        if (history.location.pathname === '/gitlab-tools/settings') return;
        Modal.info({
          title: '提示',
          content: '请先在设置中配置 GitLab 实例地址和 Token',
          onOk() {
            history.push('/settings');
          },
        });
      }
    };
    console.log('no token found');
    loadSettings();
  }, []);

  useEffect(() => {
    if (state.allGroups.length > 0) {
      fetchAllProjects();
    }
  }, [state.allGroups]);

  useEffect(() => {
    if (state.token) {
      fetchCurrentUser();
    }
  }, [state.token, fetchCurrentUser]);

  return {
    ...state,
    updateState,
    fetchAllGroups,
    fetchAllGroupsRemote,
    fetchAllProjectsRemote,
    fetchCurrentUser,
    fetchCurrentUserRemote,
    search,
  };
};

export default useGitlabModel;
