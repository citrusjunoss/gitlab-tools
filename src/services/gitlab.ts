import { request } from '@umijs/max';

// 注意：这里的 GitLab URL 应该配置在代理中，例如 /api/v4
const host = localStorage.getItem('gitlab_url');
const GITLAB_API_BASE = `${host}/api/v4`;

/**
 * 获取所有 GitLab 组
 * @param token GitLab Personal Access Token
 */
export async function getGitlabGroups(token: string, page: number = 1) {
  return request(`${GITLAB_API_BASE}/groups`, {
    method: 'GET',
    headers: {
      'PRIVATE-TOKEN': token,
    },
    params: {
      per_page: 100, // 假设最多100个组
      page, // 分页
    },
  });
}

/**
 * 获取指定组下的项目
 * @param groupId 组 ID
 * @param token GitLab Personal Access Token
 */
export async function getGitlabProjects(groupId: number, token: string) {
  return request(`${GITLAB_API_BASE}/groups/${groupId}/projects`, {
    method: 'GET',
    headers: {
      'PRIVATE-TOKEN': token,
    },
    params: {
      per_page: 100, // 假设每个组最多100个项目
    },
  });
}

/**
 * 在指定项目中搜索代码
 * @param projectId 项目 ID
 * @param keyword 搜索关键词
 * @param token GitLab Personal Access Token
 * @param ref 分支或标签名
 */
export async function searchCodeInProject(
  projectId: number,
  keyword: string,
  token: string,
  ref?: string,
) {
  const params: Record<string, any> = {
    scope: 'blobs',
    search: keyword,
  };

  if (ref) {
    params.ref = ref;
  }

  return request(`${GITLAB_API_BASE}/projects/${projectId}/search`, {
    method: 'GET',
    headers: {
      'PRIVATE-TOKEN': token,
    },
    params,
  });
}

export async function getProjectBranch(
  projectId: number,
  branch: string,
  token: string,
) {
  return request(
    `${GITLAB_API_BASE}/projects/${projectId}/repository/branches/${encodeURIComponent(
      branch,
    )}`,
    {
      method: 'GET',
      headers: {
        'PRIVATE-TOKEN': token,
      },
    },
  );
}

export async function getProjectTags(
  projectId: number,
  token: string,
  params: Record<string, any> = {},
) {
  return request(`${GITLAB_API_BASE}/projects/${projectId}/repository/tags`, {
    method: 'GET',
    headers: {
      'PRIVATE-TOKEN': token,
    },
    params: {
      per_page: 20,
      order_by: 'updated',
      sort: 'desc',
      ...params,
    },
  });
}

export async function getProjectTag(
  projectId: number,
  tagName: string,
  token: string,
) {
  return request(
    `${GITLAB_API_BASE}/projects/${projectId}/repository/tags/${encodeURIComponent(
      tagName,
    )}`,
    {
      method: 'GET',
      headers: {
        'PRIVATE-TOKEN': token,
      },
    },
  );
}

export async function compareProjectRefs(
  projectId: number,
  from: string,
  to: string,
  token: string,
) {
  return request(
    `${GITLAB_API_BASE}/projects/${projectId}/repository/compare`,
    {
      method: 'GET',
      headers: {
        'PRIVATE-TOKEN': token,
      },
      params: {
        from,
        to,
      },
    },
  );
}

export async function listProjectCommits(
  projectId: number,
  token: string,
  refName: string,
  perPage: number = 100,
) {
  return request(
    `${GITLAB_API_BASE}/projects/${projectId}/repository/commits`,
    {
      method: 'GET',
      headers: {
        'PRIVATE-TOKEN': token,
      },
      params: {
        ref_name: refName,
        per_page: perPage,
      },
    },
  );
}

export async function createProjectTag(
  projectId: number,
  token: string,
  payload: {
    tag_name: string;
    ref: string;
    message?: string;
  },
) {
  return request(`${GITLAB_API_BASE}/projects/${projectId}/repository/tags`, {
    method: 'POST',
    headers: {
      'PRIVATE-TOKEN': token,
    },
    data: payload,
  });
}

export async function getGitlabUsers(token: string, page: number = 1) {
  return request(`${GITLAB_API_BASE}/users`, {
    method: 'GET',
    headers: {
      'PRIVATE-TOKEN': token,
    },
    params: {
      per_page: 100,
      page,
    },
  });
}

export async function getCurrentGitlabUser(token: string) {
  return request(`${GITLAB_API_BASE}/user`, {
    method: 'GET',
    headers: {
      'PRIVATE-TOKEN': token,
    },
  });
}

export async function getRepositoryFile(
  projectId: number,
  filePath: string,
  ref: string,
  token: string,
) {
  return request(
    `${GITLAB_API_BASE}/projects/${projectId}/repository/files/${encodeURIComponent(
      filePath,
    )}`,
    {
      method: 'GET',
      headers: {
        'PRIVATE-TOKEN': token,
      },
      params: {
        ref,
      },
    },
  );
}

export async function createProjectBranch(
  projectId: number,
  branch: string,
  ref: string,
  token: string,
) {
  return request(
    `${GITLAB_API_BASE}/projects/${projectId}/repository/branches`,
    {
      method: 'POST',
      headers: {
        'PRIVATE-TOKEN': token,
      },
      data: {
        branch,
        ref,
      },
    },
  );
}

export async function updateRepositoryFile(
  projectId: number,
  filePath: string,
  branch: string,
  content: string,
  commitMessage: string,
  token: string,
) {
  return request(
    `${GITLAB_API_BASE}/projects/${projectId}/repository/files/${encodeURIComponent(
      filePath,
    )}`,
    {
      method: 'PUT',
      headers: {
        'PRIVATE-TOKEN': token,
      },
      data: {
        branch,
        content,
        commit_message: commitMessage,
      },
    },
  );
}

export async function listProjectMergeRequests(
  projectId: number,
  token: string,
  params: Record<string, any> = {},
) {
  return request(`${GITLAB_API_BASE}/projects/${projectId}/merge_requests`, {
    method: 'GET',
    headers: {
      'PRIVATE-TOKEN': token,
    },
    params,
  });
}

export async function createProjectMergeRequest(
  projectId: number,
  token: string,
  payload: {
    source_branch: string;
    target_branch: string;
    title: string;
    description?: string;
  },
) {
  return request(`${GITLAB_API_BASE}/projects/${projectId}/merge_requests`, {
    method: 'POST',
    headers: {
      'PRIVATE-TOKEN': token,
    },
    data: payload,
  });
}
