import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import api from '../services/api'

const Friends = () => {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const [friends, setFriends] = useState([])
  const [requests, setRequests] = useState([])
  const [searchUsername, setSearchUsername] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [activeTab, setActiveTab] = useState('friends') // 'friends', 'requests', 'add'
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState({ type: '', text: '' })

  useEffect(() => {
    if (!user) {
      navigate('/login')
      return
    }
    fetchFriends()
    fetchRequests()
  }, [user])

  // 获取好友列表
  const fetchFriends = async () => {
    try {
      const response = await api.get('/friend/list')
      setFriends(response.data.data.friends)
    } catch (error) {
      console.error('获取好友列表失败:', error)
    }
  }

  // 获取好友请求
  const fetchRequests = async () => {
    try {
      const response = await api.get('/friend/requests')
      setRequests(response.data.data.requests)
    } catch (error) {
      console.error('获取好友请求失败:', error)
    }
  }

  // 搜索用户
  const handleSearch = async () => {
    if (!searchUsername.trim()) {
      setMessage({ type: 'error', text: '请输入用户名' })
      return
    }
    setLoading(true)
    try {
      const response = await api.get(`/friend/search?username=${encodeURIComponent(searchUsername)}`)
      setSearchResults(response.data.data.users)
      if (response.data.data.users.length === 0) {
        setMessage({ type: 'info', text: '未找到该用户' })
      }
    } catch (error) {
      setMessage({ type: 'error', text: '搜索失败' })
    } finally {
      setLoading(false)
    }
  }

  // 发送好友请求
  const handleSendRequest = async (username) => {
    setLoading(true)
    try {
      const response = await api.post('/friend/request', { username })
      setMessage({ type: 'success', text: response.data.message })
      handleSearch() // 刷新搜索结果
    } catch (error) {
      setMessage({ type: 'error', text: error.response?.data?.message || '发送请求失败' })
    } finally {
      setLoading(false)
    }
  }

  // 直接添加好友（通过输入用户名）
  const handleAddByUsername = async () => {
    if (!searchUsername.trim()) {
      setMessage({ type: 'error', text: '请输入用户名' })
      return
    }
    setLoading(true)
    try {
      const response = await api.post('/friend/request', { username: searchUsername.trim() })
      setMessage({ type: 'success', text: response.data.message })
      setSearchUsername('')
      fetchFriends()
      fetchRequests()
    } catch (error) {
      setMessage({ type: 'error', text: error.response?.data?.message || '添加好友失败' })
    } finally {
      setLoading(false)
    }
  }

  // 处理好友请求
  const handleRequest = async (requestId, action) => {
    setLoading(true)
    try {
      await api.put(`/friend/request/${requestId}`, { action })
      setMessage({ type: 'success', text: action === 'accept' ? '已添加为好友' : '已拒绝请求' })
      fetchFriends()
      fetchRequests()
    } catch (error) {
      setMessage({ type: 'error', text: '处理请求失败' })
    } finally {
      setLoading(false)
    }
  }

  // 删除好友
  const handleDeleteFriend = async (friendId) => {
    if (!confirm('确定要删除该好友吗？')) return
    setLoading(true)
    try {
      await api.delete(`/friend/${friendId}`)
      setMessage({ type: 'success', text: '已删除好友' })
      fetchFriends()
    } catch (error) {
      setMessage({ type: 'error', text: '删除好友失败' })
    } finally {
      setLoading(false)
    }
  }

  // 邀请好友对战
  const handleInviteFriend = (friendId) => {
    navigate(`/matching?mode=friend&friendId=${friendId}`)
  }

  const getStatusColor = (status) => {
    switch (status) {
      case 'online': return 'bg-green-500'
      case 'playing': return 'bg-yellow-500'
      case 'matching': return 'bg-blue-500'
      default: return 'bg-gray-400'
    }
  }

  const getStatusText = (status) => {
    switch (status) {
      case 'online': return '在线'
      case 'playing': return '游戏中'
      case 'matching': return '匹配中'
      default: return '离线'
    }
  }

  return (
    <div className="max-w-4xl mx-auto p-4">
        <h1 className="text-xl md:text-2xl font-bold mb-4 md:mb-6 text-center">好友系统</h1>

        {/* 消息提示 */}
        {message.text && (
          <div className={`mb-4 p-3 rounded text-sm md:text-base ${
            message.type === 'success' ? 'bg-green-100 text-green-800' :
            message.type === 'error' ? 'bg-red-100 text-red-800' :
            'bg-blue-100 text-blue-800'
          }`}>
            {message.text}
            <button 
              className="float-right font-bold"
              onClick={() => setMessage({ type: '', text: '' })}
            >
              ×
            </button>
          </div>
        )}

        {/* 标签页 - 移动端更紧凑 */}
        <div className="flex border-b mb-4 overflow-x-auto">
          <button
            className={`px-2 md:px-4 py-3 md:py-3 text-sm md:text-base whitespace-nowrap ${activeTab === 'friends' ? 'border-b-2 border-blue-500 text-blue-500' : 'text-gray-500'}`}
            onClick={() => setActiveTab('friends')}
          >
            好友 ({friends.length})
          </button>
          <button
            className={`px-2 md:px-4 py-3 md:py-3 text-sm md:text-base whitespace-nowrap relative ${activeTab === 'requests' ? 'border-b-2 border-blue-500 text-blue-500' : 'text-gray-500'}`}
            onClick={() => setActiveTab('requests')}
          >
            请求
            {requests.length > 0 && (
              <span className="absolute -top-0 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                {requests.length}
              </span>
            )}
          </button>
          <button
            className={`px-2 md:px-4 py-3 md:py-3 text-sm md:text-base whitespace-nowrap ${activeTab === 'add' ? 'border-b-2 border-blue-500 text-blue-500' : 'text-gray-500'}`}
            onClick={() => setActiveTab('add')}
          >
            添加好友
          </button>
        </div>

        {/* 好友列表 */}
        {activeTab === 'friends' && (
          <div className="space-y-3">
            {friends.length === 0 ? (
              <p className="text-center text-gray-500 py-8">暂无好友，快去添加吧！</p>
            ) : (
              friends.map(friend => (
                <div key={friend.id} className="p-3 md:p-4 bg-white rounded-lg shadow">
                  {/* 移动端：垂直布局，PC端：水平布局 */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center flex-1 min-w-0">
                      <div className="relative flex-shrink-0">
                        <img 
                          src={friend.avatar || '/default-avatar.png'} 
                          alt={friend.nickname}
                          className="w-10 h-10 md:w-12 md:h-12 rounded-full object-cover"
                        />
                        <span className={`absolute bottom-0 right-0 w-2.5 h-2.5 md:w-3 md:h-3 rounded-full border-2 border-white ${getStatusColor(friend.status)}`}></span>
                      </div>
                      <div className="ml-2 md:ml-3 min-w-0">
                        <p className="font-semibold text-sm md:text-base truncate">{friend.nickname || friend.username}</p>
                        <p className="text-xs md:text-sm text-gray-500">
                          <span className={`${friend.status === 'online' ? 'text-green-600' : 'text-gray-400'}`}>
                            {getStatusText(friend.status)}
                          </span>
                          <span className="mx-1 md:mx-2">·</span>
                          <span className="hidden sm:inline">积分: </span>{friend.score}
                          <span className="hidden sm:inline">
                            <span className="mx-2">·</span>
                            胜率: {friend.total_games > 0 ? Math.round(friend.win_games / friend.total_games * 100) : 0}%
                          </span>
                        </p>
                      </div>
                    </div>
                    {/* 操作按钮 */}
                    <div className="flex gap-1 md:gap-2 ml-2 flex-shrink-0">
                      {friend.status === 'online' && (
                        <button
                          className="px-2 md:px-3 py-1 text-xs md:text-sm bg-blue-500 text-white rounded hover:bg-blue-600"
                          onClick={() => handleInviteFriend(friend.id)}
                        >
                          <span className="hidden sm:inline">邀请对战</span>
                          <span className="sm:hidden">邀请</span>
                        </button>
                      )}
                      <button
                        className="px-2 md:px-3 py-1 text-xs md:text-sm bg-red-100 text-red-600 rounded hover:bg-red-200"
                        onClick={() => handleDeleteFriend(friend.id)}
                      >
                        删除
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* 好友请求 */}
        {activeTab === 'requests' && (
          <div className="space-y-3">
            {requests.length === 0 ? (
              <p className="text-center text-gray-500 py-8">暂无好友请求</p>
            ) : (
              requests.map(request => (
                <div key={request.id} className="p-3 md:p-4 bg-white rounded-lg shadow">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center flex-1 min-w-0">
                      <img 
                        src={request.avatar || '/default-avatar.png'} 
                        alt={request.nickname}
                        className="w-10 h-10 md:w-12 md:h-12 rounded-full object-cover flex-shrink-0"
                      />
                      <div className="ml-2 md:ml-3 min-w-0">
                        <p className="font-semibold text-sm md:text-base truncate">{request.nickname || request.username}</p>
                        <p className="text-xs md:text-sm text-gray-500">
                          <span className="hidden sm:inline">积分: </span>{request.score}
                          <span className="mx-1 md:mx-2">·</span>
                          {new Date(request.created_at).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-1 md:gap-2 ml-2 flex-shrink-0">
                      <button
                        className="px-2 md:px-3 py-1 text-xs md:text-sm bg-green-500 text-white rounded hover:bg-green-600"
                        onClick={() => handleRequest(request.id, 'accept')}
                        disabled={loading}
                      >
                        接受
                      </button>
                      <button
                        className="px-2 md:px-3 py-1 text-xs md:text-sm bg-gray-300 text-gray-700 rounded hover:bg-gray-400"
                        onClick={() => handleRequest(request.id, 'reject')}
                        disabled={loading}
                      >
                        拒绝
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* 添加好友 */}
        {activeTab === 'add' && (
          <div className="space-y-4">
            <div className="bg-white p-3 md:p-4 rounded-lg shadow">
              <h3 className="font-semibold mb-3 text-sm md:text-base">通过用户名添加好友</h3>
              {/* 移动端：垂直布局，PC端：水平布局 */}
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={searchUsername}
                  onChange={(e) => setSearchUsername(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleAddByUsername()}
                  placeholder="输入用户名"
                  className="flex-1 px-3 py-2 text-sm md:text-base border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <div className="flex gap-2">
                  <button
                    className="flex-1 sm:flex-none px-3 md:px-4 py-2 text-sm md:text-base bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-400"
                    onClick={handleAddByUsername}
                    disabled={loading}
                  >
                    发送请求
                  </button>
                  <button
                    className="flex-1 sm:flex-none px-3 md:px-4 py-2 text-sm md:text-base bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                    onClick={handleSearch}
                    disabled={loading}
                  >
                    搜索
                  </button>
                </div>
              </div>
            </div>

            {/* 搜索结果 */}
            {searchResults.length > 0 && (
              <div className="space-y-3">
                <h3 className="font-semibold text-sm md:text-base">搜索结果</h3>
                {searchResults.map(user => (
                  <div key={user.id} className="p-3 md:p-4 bg-white rounded-lg shadow">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center flex-1 min-w-0">
                        <img 
                          src={user.avatar || '/default-avatar.png'} 
                          alt={user.nickname}
                          className="w-10 h-10 md:w-12 md:h-12 rounded-full object-cover flex-shrink-0"
                        />
                        <div className="ml-2 md:ml-3 min-w-0">
                          <p className="font-semibold text-sm md:text-base truncate">{user.nickname || user.username}</p>
                          <p className="text-xs md:text-sm text-gray-500 truncate">@{user.username} · <span className="hidden sm:inline">积分: </span>{user.score}</p>
                        </div>
                      </div>
                      <div className="ml-2 flex-shrink-0">
                        {user.relationship === 'friend' ? (
                          <span className="px-2 md:px-3 py-1 text-xs md:text-sm bg-green-100 text-green-600 rounded">已是好友</span>
                        ) : user.relationship === 'pending' ? (
                          <span className="px-2 md:px-3 py-1 text-xs md:text-sm bg-yellow-100 text-yellow-600 rounded">已发送</span>
                        ) : (
                          <button
                            className="px-2 md:px-3 py-1 text-xs md:text-sm bg-blue-500 text-white rounded hover:bg-blue-600"
                            onClick={() => handleSendRequest(user.username)}
                            disabled={loading}
                          >
                            添加
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 返回按钮 */}
        <div className="mt-6 text-center">
          <button
            className="px-6 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
            onClick={() => navigate('/')}
          >
            返回大厅
          </button>
        </div>
      </div>
  )
}

export default Friends
