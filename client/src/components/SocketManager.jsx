import { useEffect, useRef } from 'react'
import { useAuthStore } from '../store/authStore'
import socketService from '../services/socket'

// Socket连接管理组件
// 当用户登录后自动连接Socket，登出后断开连接
const SocketManager = () => {
  const { token, isAuthenticated, logout } = useAuthStore()
  const hasSetupRef = useRef(false)

  useEffect(() => {
    if (isAuthenticated && token) {
      // 只在首次设置回调，避免重复设置
      if (!hasSetupRef.current) {
        // 设置登录错误回调（账号在其他地方登录时）
        socketService.setLoginErrorCallback((message) => {
          alert(message)
          // 注意：这里不调用 logout()，因为那会发送 /auth/logout 请求
          // 使其他设备的 token 失效。我们只清除本地状态
          useAuthStore.setState({ user: null, token: null, isAuthenticated: false })
          localStorage.removeItem('auth-storage')
          window.location.href = '/login'
        })
        hasSetupRef.current = true
      }

      // 连接Socket
      socketService.connect(token)
    }
    
    // 注意：不要在这里断开连接，只有在用户真正登出时才断开
    // 移除了 else 分支中的 disconnect 和 return 中的 disconnect
  }, [isAuthenticated, token, logout])

  // 只在用户登出时断开连接
  useEffect(() => {
    if (!isAuthenticated) {
      socketService.disconnect()
      hasSetupRef.current = false
    }
  }, [isAuthenticated])

  // 此组件不渲染任何内容
  return null
}

export default SocketManager
