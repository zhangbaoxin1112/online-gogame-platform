import { io } from 'socket.io-client'

class SocketService {
  constructor() {
    this.socket = null
    this.listeners = new Map()
    this.onLoginError = null  // 登录错误回调
    this.token = null  // 保存token用于重连
    this.visibilityHandler = null  // 页面可见性处理器
    
    // 生成唯一的客户端标识符，用于区分同一客户端的重连和真正的多设备登录
    // 存储在 sessionStorage 中，刷新页面保持，关闭标签页重新生成
    this.clientId = sessionStorage.getItem('socket_client_id') || this.generateClientId()
    sessionStorage.setItem('socket_client_id', this.clientId)
  }

  // 生成唯一的客户端ID
  generateClientId() {
    return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  // 设置登录错误回调
  setLoginErrorCallback(callback) {
    this.onLoginError = callback
  }

  // 连接到服务器
  connect(token) {
    // 保存token用于后续重连
    this.token = token

    // 如果已有socket实例（无论是否connected），不重新创建
    if (this.socket) {
      // 如果已连接，直接返回
      if (this.socket.connected) {
        return this.socket
      }
      // 如果socket存在但未连接，可能正在重连中，也直接返回
      // 避免创建多个socket实例导致"多处登录"问题
      return this.socket
    }

    this.socket = io(window.location.origin, {
      auth: { token, clientId: this.clientId },
      reconnection: true,
      reconnectionAttempts: 10,  // 增加重连次数
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000
    })

    this.socket.on('connect', () => {
      console.log('Socket连接成功')
      // 连接成功后请求在线人数
      this.socket.emit('get_online_count')
      // 连接/重连成功时主动声明页面可见状态
      if (document.visibilityState === 'visible') {
        this.socket.emit('client_visible')
      } else {
        this.socket.emit('client_hidden')
      }
    })

    this.socket.on('disconnect', (reason) => {
      console.log('Socket断开连接:', reason)
      // 不在这里做任何登出操作，让 Socket.io 自动重连
    })

    this.socket.on('connect_error', (error) => {
      console.error('Socket连接错误:', error.message)
    })

    // 处理登录错误（账号已在其他地方登录）
    this.socket.on('login_error', (data) => {
      console.error('登录错误:', data.message)
      if (this.onLoginError) {
        this.onLoginError(data.message)
      } else {
        alert(data.message)
      }
    })

    // 设置页面可见性监听（处理移动端后台切换）
    this.setupVisibilityHandler()

    return this.socket
  }

  // 设置页面可见性处理器
  setupVisibilityHandler() {
    // 移除旧的监听器
    if (this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler)
    }
    if (this.unloadHandler) {
      window.removeEventListener('beforeunload', this.unloadHandler)
    }

    this.visibilityHandler = () => {
      if (document.visibilityState === 'visible') {
        console.log('页面变为可见，检查Socket连接状态')
        // 页面重新可见时，检查连接状态
        if (this.socket && !this.socket.connected) {
          console.log('Socket未连接，尝试重连...')
          this.socket.connect()
        } else if (this.socket && this.socket.connected) {
          this.socket.emit('client_visible')
        }
      } else {
        console.log('页面变为不可见')
        if (this.socket && this.socket.connected) {
          this.socket.emit('client_hidden')
        }
      }
    }

    document.addEventListener('visibilitychange', this.visibilityHandler)

    // 添加页面卸载(关闭或刷新)时的监听
    this.unloadHandler = () => {
      if (this.socket && this.socket.connected) {
        this.socket.emit('page_close')
      }
    }
    window.addEventListener('beforeunload', this.unloadHandler)
  }

  // 断开连接
  disconnect() {
    // 移除页面可见性监听器
    if (this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler)
      this.visibilityHandler = null
    }
    if (this.unloadHandler) {
      window.removeEventListener('beforeunload', this.unloadHandler)
      this.unloadHandler = null
    }
    
    if (this.socket) {
      this.socket.disconnect()
      this.socket = null
    }
  }

  // 发送消息
  emit(event, data) {
    if (this.socket?.connected) {
      this.socket.emit(event, data)
    } else {
      console.warn('Socket未连接')
    }
  }

  // 监听事件
  on(event, callback) {
    if (this.socket) {
      this.socket.on(event, callback)
      
      // 记录监听器以便清理
      if (!this.listeners.has(event)) {
        this.listeners.set(event, [])
      }
      this.listeners.get(event).push(callback)
    }
  }

  // 移除事件监听
  off(event, callback) {
    if (this.socket) {
      if (callback) {
        this.socket.off(event, callback)
      } else {
        this.socket.off(event)
      }
    }
  }

  // 清理所有监听器
  removeAllListeners() {
    if (this.socket) {
      for (const event of this.listeners.keys()) {
        this.socket.off(event)
      }
      this.listeners.clear()
    }
  }

  // 检查连接状态
  isConnected() {
    return this.socket?.connected || false
  }

  // 获取Socket实例
  getSocket() {
    return this.socket
  }

  // ==================== 匹配相关 ====================

  // 开始匹配
  startMatching(boardSize = 19, matchMode = 'random') {
    this.emit('start_matching', { boardSize, matchMode })
  }

  // 取消匹配
  cancelMatching() {
    this.emit('cancel_matching')
  }

  // 邀请好友对战
  inviteFriend(friendId, boardSize = 19) {
    this.emit('invite_friend', { friendId, boardSize })
  }

  // 接受好友邀请
  acceptInvite(inviteId) {
    this.emit('accept_invite', { inviteId })
  }

  // 拒绝好友邀请
  rejectInvite(inviteId) {
    this.emit('reject_invite', { inviteId })
  }

  // ==================== 游戏相关 ====================

  // 落子
  placeStone(roomId, x, y) {
    this.emit('place_stone', { roomId, x, y })
  }

  // 认输
  resign(roomId) {
    this.emit('resign', { roomId })
  }

  // 请求和棋
  requestDraw(roomId) {
    this.emit('request_draw', { roomId })
  }

  // 接受和棋
  acceptDraw(roomId) {
    this.emit('accept_draw', { roomId })
  }

  // 拒绝和棋
  rejectDraw(roomId) {
    this.emit('reject_draw', { roomId })
  }

  // PASS
  pass(roomId) {
    this.emit('pass', { roomId })
  }

  // 发送聊天消息
  sendChatMessage(roomId, message) {
    this.emit('chat_message', { roomId, message })
  }

  // 重新连接游戏
  reconnectGame(roomId) {
    this.emit('reconnect_game', { roomId })
  }
}

// 导出单例
const socketService = new SocketService()
export default socketService
