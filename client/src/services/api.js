import axios from 'axios'

// 创建axios实例
const api = axios.create({
  baseURL: '/api',
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json'
  }
})

// 请求拦截器
api.interceptors.request.use(
  (config) => {
    // token已在authStore中设置
    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)

// 响应拦截器
api.interceptors.response.use(
  (response) => {
    return response
  },
  (error) => {
    // 处理401错误
    if (error.response?.status === 401) {
      // 可以在这里处理token过期
      localStorage.removeItem('auth-storage')
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)

export default api

// API服务函数
export const authAPI = {
  login: (username, password) => api.post('/auth/login', { username, password }),
  register: (username, password, nickname) => api.post('/auth/register', { username, password, nickname }),
  logout: () => api.post('/auth/logout'),
  verify: () => api.get('/auth/verify')
}

export const userAPI = {
  getProfile: () => api.get('/user/profile'),
  updateProfile: (data) => api.put('/user/profile', data),
  uploadAvatar: (formData) => api.post('/user/avatar', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 30000  // 上传文件超时时间延长到30秒
  }),
  changePassword: (oldPassword, newPassword) => 
    api.put('/user/password', { oldPassword, newPassword }),
  getGameHistory: (page = 1, limit = 10) => 
    api.get(`/user/games/history?page=${page}&limit=${limit}`),
  getScoreLogs: (page = 1, limit = 20) => 
    api.get(`/user/score/logs?page=${page}&limit=${limit}`)
}

export const gameAPI = {
  getGame: (id) => api.get(`/game/${id}`),
  createPVE: (aiLevel, boardSize, playAsBlack) => 
    api.post('/game/pve', { aiLevel, boardSize, playAsBlack }),
  finishPVE: (gameId, winnerId, movesRecord, result, duration) =>
    api.put(`/game/pve/${gameId}/finish`, { winnerId, movesRecord, result, duration }),
  getGames: (page = 1, limit = 10, type) => {
    let url = `/game?page=${page}&limit=${limit}`
    if (type) url += `&type=${type}`
    return api.get(url)
  }
}

export const rankAPI = {
  getLeaderboard: (page = 1, limit = 50) => 
    api.get(`/rank/leaderboard?page=${page}&limit=${limit}`),
  getUserRank: (userId) => api.get(`/rank/user/${userId}`),
  getDailyRank: (limit = 20) => api.get(`/rank/daily?limit=${limit}`),
  getStats: () => api.get('/rank/stats')
}
