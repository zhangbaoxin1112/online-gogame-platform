import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { useState, useEffect, useCallback, useRef } from 'react'
import socketService from '../services/socket'

const Layout = () => {
  const { user, isAuthenticated, token, logout } = useAuthStore()
  const location = useLocation()
  const navigate = useNavigate()
  const [showMobileMenu, setShowMobileMenu] = useState(false)
  const [showUserMenu, setShowUserMenu] = useState(false)
  
  // 好友邀请状态
  const [friendInvite, setFriendInvite] = useState(null)
  
  // 用ref跟踪当前路径，避免闭包问题
  const locationRef = useRef(location.pathname)
  useEffect(() => {
    locationRef.current = location.pathname
  }, [location.pathname])

  // 监听全局好友邀请和匹配成功
  useEffect(() => {
    if (!isAuthenticated || !token) return

    // 确保Socket连接
    socketService.connect(token)

    // 监听好友邀请
    const handleFriendInvite = (data) => {
      console.log('收到好友邀请:', data)
      // 如果当前在游戏页面或匹配页面，不显示弹窗（由各自页面处理）
      if (locationRef.current === '/game/pvp' || locationRef.current === '/game/pve' || locationRef.current === '/matching') {
        return
      }
      setFriendInvite(data)
    }

    // 监听匹配成功（好友邀请被接受后）
    const handleMatchFound = (data) => {
      console.log('匹配成功:', data)
      // 清除邀请弹窗
      setFriendInvite(null)
      // 如果不在游戏页面，导航到PVP游戏页面
      if (locationRef.current !== '/game/pvp') {
        navigate('/game/pvp', { state: data })
      }
    }

    socketService.on('friend_invite', handleFriendInvite)
    socketService.on('match_found', handleMatchFound)

    return () => {
      socketService.off('friend_invite', handleFriendInvite)
      socketService.off('match_found', handleMatchFound)
    }
  }, [isAuthenticated, token]) // 移除 location.pathname 依赖，避免每次路由变化都重新执行

  // 接受邀请
  const handleAcceptInvite = useCallback(() => {
    if (!friendInvite) return
    socketService.emit('accept_invite', { inviteId: friendInvite.inviteId })
    setFriendInvite(null)
    // 匹配成功后 match_found 事件会触发导航
  }, [friendInvite])

  // 拒绝邀请
  const handleRejectInvite = useCallback(() => {
    if (!friendInvite) return
    socketService.emit('reject_invite', { inviteId: friendInvite.inviteId })
    setFriendInvite(null)
  }, [friendInvite])

  const handleLogout = async () => {
    await logout()
    navigate('/')
  }

  const navItems = [
    { path: '/', label: '首页', icon: '🏠' },
    { path: '/leaderboard', label: '排行榜', icon: '🏆' },
  ]

  const authNavItems = [
    { path: '/history', label: '对局记录', icon: '📋' },
    { path: '/profile', label: '个人中心', icon: '👤' },
  ]

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 顶部导航栏 */}
      <nav className="bg-gray-900 text-white shadow-lg sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <Link to="/" className="flex items-center space-x-2">
              <span className="text-2xl">⚫</span>
              <span className="font-bold text-xl hidden sm:block">网络围棋</span>
            </Link>

            {/* 桌面端导航 */}
            <div className="hidden md:flex items-center space-x-6">
              {navItems.map(item => (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`flex items-center space-x-1 px-3 py-2 rounded-lg transition-colors
                    ${location.pathname === item.path 
                      ? 'bg-gray-700 text-white' 
                      : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
                >
                  <span>{item.icon}</span>
                  <span>{item.label}</span>
                </Link>
              ))}
              
              {isAuthenticated && authNavItems.map(item => (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`flex items-center space-x-1 px-3 py-2 rounded-lg transition-colors
                    ${location.pathname === item.path 
                      ? 'bg-gray-700 text-white' 
                      : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
                >
                  <span>{item.icon}</span>
                  <span>{item.label}</span>
                </Link>
              ))}
            </div>

            {/* 用户菜单 */}
            <div className="flex items-center space-x-4">
              {isAuthenticated ? (
                <div className="relative">
                  <button
                    onClick={() => setShowUserMenu(!showUserMenu)}
                    className="flex items-center space-x-2 px-3 py-2 rounded-lg hover:bg-gray-800 transition-colors"
                  >
                    <div className="w-8 h-8 bg-gray-600 rounded-full flex items-center justify-center overflow-hidden">
                      {user?.avatar ? (
                        <img src={user.avatar} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-sm">{user?.nickname?.charAt(0) || '?'}</span>
                      )}
                    </div>
                    <span className="hidden sm:block">{user?.nickname}</span>
                    <span className="text-yellow-400 text-sm">{user?.score || 0}分</span>
                  </button>

                  {showUserMenu && (
                    <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg py-2 z-50">
                      <Link
                        to="/profile"
                        className="block px-4 py-2 text-gray-800 hover:bg-gray-100"
                        onClick={() => setShowUserMenu(false)}
                      >
                        👤 个人中心
                      </Link>
                      <Link
                        to="/history"
                        className="block px-4 py-2 text-gray-800 hover:bg-gray-100"
                        onClick={() => setShowUserMenu(false)}
                      >
                        📋 对局记录
                      </Link>
                      <hr className="my-2" />
                      <button
                        onClick={handleLogout}
                        className="w-full text-left px-4 py-2 text-red-600 hover:bg-gray-100"
                      >
                        🚪 退出登录
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex items-center space-x-2">
                  <Link
                    to="/login"
                    className="px-4 py-2 text-gray-300 hover:text-white transition-colors"
                  >
                    登录
                  </Link>
                  <Link
                    to="/register"
                    className="px-4 py-2 bg-white text-gray-900 rounded-lg hover:bg-gray-200 transition-colors"
                  >
                    注册
                  </Link>
                </div>
              )}

              {/* 移动端菜单按钮 */}
              <button
                className="md:hidden p-2 rounded-lg hover:bg-gray-800"
                onClick={() => setShowMobileMenu(!showMobileMenu)}
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* 移动端菜单 */}
        {showMobileMenu && (
          <div className="md:hidden bg-gray-800 border-t border-gray-700">
            <div className="px-4 py-2 space-y-1">
              {navItems.map(item => (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`flex items-center space-x-2 px-3 py-3 rounded-lg
                    ${location.pathname === item.path 
                      ? 'bg-gray-700 text-white' 
                      : 'text-gray-300 hover:bg-gray-700'}`}
                  onClick={() => setShowMobileMenu(false)}
                >
                  <span>{item.icon}</span>
                  <span>{item.label}</span>
                </Link>
              ))}
              
              {isAuthenticated && authNavItems.map(item => (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`flex items-center space-x-2 px-3 py-3 rounded-lg
                    ${location.pathname === item.path 
                      ? 'bg-gray-700 text-white' 
                      : 'text-gray-300 hover:bg-gray-700'}`}
                  onClick={() => setShowMobileMenu(false)}
                >
                  <span>{item.icon}</span>
                  <span>{item.label}</span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </nav>

      {/* 点击空白处关闭菜单 */}
      {(showUserMenu || showMobileMenu) && (
        <div 
          className="fixed inset-0 z-40" 
          onClick={() => {
            setShowUserMenu(false)
            setShowMobileMenu(false)
          }}
        />
      )}

      {/* 全局好友邀请弹窗 */}
      {friendInvite && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full mx-4 transform animate-bounce-in">
            <div className="text-center">
              <div className="text-4xl mb-4">⚔️</div>
              <h3 className="text-xl font-bold mb-2">好友对战邀请</h3>
              <p className="text-gray-600 mb-4">
                <span className="font-semibold text-gray-900">{friendInvite.fromName}</span>
                <span className="text-yellow-600 text-sm ml-2">({friendInvite.fromScore}分)</span>
              </p>
              <p className="text-gray-500 text-sm mb-6">
                邀请你进行 {friendInvite.boardSize}×{friendInvite.boardSize} 围棋对战
              </p>
              
              <div className="flex gap-3">
                <button
                  onClick={handleRejectInvite}
                  className="flex-1 px-4 py-3 bg-gray-200 text-gray-700 rounded-xl hover:bg-gray-300 transition-colors font-medium"
                >
                  拒绝
                </button>
                <button
                  onClick={handleAcceptInvite}
                  className="flex-1 px-4 py-3 bg-gray-900 text-white rounded-xl hover:bg-gray-700 transition-colors font-medium"
                >
                  接受挑战
                </button>
              </div>
              
              <p className="text-xs text-gray-400 mt-4">胜利+15分 / 失败-15分</p>
            </div>
          </div>
        </div>
      )}

      {/* 主内容区域 */}
      <main className="max-w-7xl mx-auto px-4 py-6">
        <Outlet />
      </main>

      {/* 页脚 */}
      <footer className="bg-gray-900 text-gray-400 py-8 mt-auto">
        <div className="max-w-7xl mx-auto px-4 text-center">
          <p>© 2024 网络围棋 - 系统能力培养综合实践</p>
          <p className="text-sm mt-2">支持 PC端 / 移动端</p>
        </div>
      </footer>
    </div>
  )
}

export default Layout
