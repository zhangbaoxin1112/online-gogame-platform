import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import api from '../services/api'

export const useAuthStore = create(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: true,

      // 设置token到api实例
      setToken: (token) => {
        if (token) {
          api.defaults.headers.common['Authorization'] = `Bearer ${token}`
        } else {
          delete api.defaults.headers.common['Authorization']
        }
      },

      // 登录
      login: async (username, password) => {
        try {
          const response = await api.post('/auth/login', { username, password })
          const { token, user } = response.data.data
          
          get().setToken(token)
          set({ user, token, isAuthenticated: true, isLoading: false })
          
          return { success: true }
        } catch (error) {
          return { 
            success: false, 
            message: error.response?.data?.message || '登录失败' 
          }
        }
      },

      // 注册
      register: async (username, password, nickname) => {
        try {
          const response = await api.post('/auth/register', { username, password, nickname })
          const { token, user } = response.data.data
          
          get().setToken(token)
          set({ user, token, isAuthenticated: true, isLoading: false })
          
          return { success: true }
        } catch (error) {
          return { 
            success: false, 
            message: error.response?.data?.message || '注册失败' 
          }
        }
      },

      // 登出
      logout: async () => {
        try {
          await api.post('/auth/logout')
        } catch (error) {
          // 忽略错误
        }
        
        get().setToken(null)
        set({ user: null, token: null, isAuthenticated: false })
      },

      // 验证token
      verifyToken: async () => {
        const { token } = get()
        
        if (!token) {
          set({ isLoading: false })
          return false
        }
        
        get().setToken(token)
        
        try {
          const response = await api.get('/auth/verify')
          set({ user: response.data.data.user, isAuthenticated: true, isLoading: false })
          return true
        } catch (error) {
          get().logout() // 统一使用退出逻辑清理所有状态
          return false
        }
      },

      // 更新用户信息
      updateUser: (userData) => {
        set(state => ({ 
          user: { ...state.user, ...userData } 
        }))
      },

      // 初始化（应用启动时调用）
      initialize: async () => {
        await get().verifyToken()
      }
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({ token: state.token })
    }
  )
)

// 应用启动时自动初始化
useAuthStore.getState().initialize()
