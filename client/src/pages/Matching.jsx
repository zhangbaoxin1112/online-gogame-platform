import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import socketService from '../services/socket'
import api from '../services/api'

const MATCH_TIMEOUT = 60 // 匹配超时时间（秒）
const MIN_SCORE_FOR_PVP = 100 // PVP所需最低积分

const Matching = () => {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { user, token } = useAuthStore()
  
  // 匹配模式: random(随机匹配), friend(好友对战), normal(普通匹配), easy(入门匹配), hard(高手匹配)
  const [matchMode, setMatchMode] = useState('random')
  const [isMatching, setIsMatching] = useState(false)
  const [matchTime, setMatchTime] = useState(0)
  const [error, setError] = useState('')
  const [showTimeoutDialog, setShowTimeoutDialog] = useState(false)
  
  // 好友邀请相关
  const [friends, setFriends] = useState([])
  const [selectedFriend, setSelectedFriend] = useState(null)
  const [inviteCode, setInviteCode] = useState('')
  const [waitingForFriend, setWaitingForFriend] = useState(false)
  const [pendingInvite, setPendingInvite] = useState(null)

  // 检查积分是否足够
  const canPlayPVP = user?.score >= MIN_SCORE_FOR_PVP

  useEffect(() => {
    // 从URL参数获取匹配模式
    const mode = searchParams.get('mode')
    const friendId = searchParams.get('friendId')
    if (mode) {
      setMatchMode(mode)
    }
    if (friendId) {
      setSelectedFriend({ id: parseInt(friendId) })
    }
  }, [searchParams])

  useEffect(() => {
    // 获取好友列表
    const fetchFriends = async () => {
      try {
        const response = await api.get('/friend/list')
        setFriends(response.data.data.friends)
      } catch (error) {
        console.error('获取好友列表失败:', error)
      }
    }
    if (user) {
      fetchFriends()
    }
  }, [user])

  useEffect(() => {
    // 连接Socket
    if (token) {
      socketService.connect(token)
      


      // 监听匹配成功
      socketService.on('match_found', (data) => {
        console.log('匹配成功:', data)
        navigate('/game/pvp', { 
          state: { 
            roomId: data.roomId,
            gameId: data.gameId,
            boardSize: data.boardSize,
            blackPlayer: data.blackPlayer,
            whitePlayer: data.whitePlayer,
            matchMode: matchMode
          }
        })
      })

      // 监听自己的颜色
      socketService.on('your_color', (data) => {
        console.log('你的颜色:', data.color)
      })

      // 监听匹配开始
      socketService.on('matching_started', (data) => {
        console.log('开始匹配, 队列位置:', data.position)
        if (data.inviteCode) {
          setInviteCode(data.inviteCode)
        }
      })

      // 监听匹配取消
      socketService.on('matching_cancelled', () => {
        setIsMatching(false)
        setMatchTime(0)
        setWaitingForFriend(false)
        setInviteCode('')
      })

      // 监听匹配错误
      socketService.on('matching_error', (data) => {
        setError(data.message)
        setIsMatching(false)
        setWaitingForFriend(false)
      })

      // 监听好友邀请
      socketService.on('friend_invite', (data) => {
        console.log('收到好友邀请:', data)
        setPendingInvite(data)
      })

      // 监听好友拒绝邀请
      socketService.on('invite_rejected', (data) => {
        setError(`${data.friendName} 拒绝了你的邀请`)
        setWaitingForFriend(false)
        setIsMatching(false)
      })
    }

    return () => {

      socketService.off('match_found')
      socketService.off('your_color')
      socketService.off('matching_started')
      socketService.off('matching_cancelled')
      socketService.off('matching_error')
      socketService.off('friend_invite')
      socketService.off('invite_rejected')
    }
  }, [token, navigate, matchMode])

  // 匹配计时器 + 超时处理
  useEffect(() => {
    let timer
    if (isMatching && !waitingForFriend) {
      timer = setInterval(() => {
        setMatchTime(prev => {
          const newTime = prev + 1
          if (newTime >= MATCH_TIMEOUT && !showTimeoutDialog) {
            setShowTimeoutDialog(true)
          }
          return newTime
        })
      }, 1000)
    }
    return () => clearInterval(timer)
  }, [isMatching, waitingForFriend, showTimeoutDialog])

  const handleStartMatching = () => {
    if (!canPlayPVP) {
      setError(`积分不足，需要 ${MIN_SCORE_FOR_PVP} 分才能参与在线对战`)
      return
    }
    setError('')
    setIsMatching(true)
    setMatchTime(0)
    setShowTimeoutDialog(false)
    socketService.startMatching(19, matchMode)
  }

  const handleInviteFriend = (friend) => {
    if (!canPlayPVP) {
      setError(`积分不足，需要 ${MIN_SCORE_FOR_PVP} 分才能参与在线对战`)
      return
    }
    setError('')
    setSelectedFriend(friend)
    setWaitingForFriend(true)
    setIsMatching(true)
    socketService.inviteFriend(friend.id, 19)
  }

  const handleCancelMatching = () => {
    socketService.cancelMatching()
    setIsMatching(false)
    setMatchTime(0)
    setShowTimeoutDialog(false)
    setWaitingForFriend(false)
    setInviteCode('')
  }

  const handleAcceptInvite = () => {
    if (!canPlayPVP) {
      setError(`积分不足，需要 ${MIN_SCORE_FOR_PVP} 分才能参与在线对战`)
      setPendingInvite(null)
      return
    }
    socketService.acceptInvite(pendingInvite.inviteId)
    setPendingInvite(null)
  }

  const handleRejectInvite = () => {
    socketService.rejectInvite(pendingInvite.inviteId)
    setPendingInvite(null)
  }

  const handleContinueMatching = () => {
    setShowTimeoutDialog(false)
    setMatchTime(0)
  }

  const handleGiveUpMatching = () => {
    handleCancelMatching()
    navigate('/')
  }

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }

  const getModeDescription = (mode) => {
    switch (mode) {
      case 'random':
        return '随机匹配任意在线玩家'
      case 'friend':
        return '邀请好友进行对战'
      case 'normal':
        return '匹配积分相近的玩家（±100分）'
      case 'easy':
        return '匹配积分较低的玩家（您的积分-100以下）'
      case 'hard':
        return '匹配积分较高的玩家（您的积分+100以上）'
      default:
        return ''
    }
  }

  const getScoreRulesDescription = (mode) => {
    switch (mode) {
      case 'random':
        return '胜利+20分，失败-20分'
      case 'normal':
        return '胜利+30分，失败-30分'
      case 'easy':
        return '胜利+10分，失败-10分'
      case 'hard':
        return '胜利+50分，失败-50分'
      case 'friend':
        return '胜利+15分，失败-15分'
      default:
        return ''
    }
  }

  // 积分不足提示
  if (!canPlayPVP) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
          <div className="text-6xl mb-4">🔒</div>
          <h1 className="text-2xl font-bold mb-4">积分不足</h1>
          <p className="text-gray-600 mb-4">
            参与在线对战需要至少 <span className="text-red-500 font-bold">{MIN_SCORE_FOR_PVP}</span> 积分
          </p>
          <p className="text-gray-600 mb-6">
            您当前积分: <span className="text-yellow-600 font-bold">{user?.score || 0}</span>
          </p>
          <p className="text-sm text-gray-500 mb-6">
            💡 提示：通过人机对战赢取积分！<br/>
            初级+10分，中级+20分，高级+30分
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => navigate('/game/pve')}
              className="btn-primary flex-1"
            >
              人机对战
            </button>
            <button
              onClick={() => navigate('/')}
              className="btn-secondary flex-1"
            >
              返回大厅
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg p-8 max-w-lg w-full">


        {!isMatching ? (
          <>
            <h1 className="text-2xl font-bold mb-6 text-center">🌐 网络对战</h1>
            
            {/* 用户信息 */}
            <div className="flex items-center justify-center gap-4 mb-6 p-4 bg-gray-50 rounded-xl">
              <div className="w-12 h-12 bg-gray-200 rounded-full flex items-center justify-center overflow-hidden">
                {user?.avatar ? (
                  <img src={user.avatar} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span>{user?.nickname?.charAt(0) || '?'}</span>
                )}
              </div>
              <div className="text-left">
                <p className="font-bold">{user?.nickname}</p>
                <p className="text-sm text-yellow-600">{user?.score} 积分</p>
              </div>
            </div>

            {/* 匹配模式选择 */}
            <div className="mb-6">
              <h3 className="font-semibold mb-3">选择匹配模式</h3>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { value: 'random', label: '🎲 随机匹配', icon: '🎲' },
                  { value: 'normal', label: '⚖️ 普通匹配', icon: '⚖️' },
                  { value: 'easy', label: '🌱 入门匹配', icon: '🌱' },
                  { value: 'hard', label: '🔥 高手匹配', icon: '🔥' },
                ].map(mode => (
                  <button
                    key={mode.value}
                    onClick={() => setMatchMode(mode.value)}
                    className={`p-3 rounded-lg border-2 transition-all ${
                      matchMode === mode.value 
                        ? 'border-blue-500 bg-blue-50 text-blue-600' 
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <span className="text-lg">{mode.icon}</span>
                    <p className="text-sm font-medium">{mode.label.split(' ')[1]}</p>
                  </button>
                ))}
              </div>
              <p className="text-sm text-gray-500 mt-2 text-center">
                {getModeDescription(matchMode)}
              </p>
              <p className="text-sm text-blue-600 mt-1 text-center">
                {getScoreRulesDescription(matchMode)}
              </p>
            </div>

            {error && (
              <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-lg text-sm">
                {error}
              </div>
            )}

            {/* 开始匹配按钮 */}
            <button
              onClick={handleStartMatching}
              className="btn-success w-full py-3 text-lg mb-3"
            >
              开始匹配
            </button>

            {/* 好友对战 */}
            <div className="border-t pt-4 mt-4">
              <h3 className="font-semibold mb-3">👥 邀请好友对战</h3>
              {friends.length === 0 ? (
                <p className="text-gray-500 text-sm text-center py-2">
                  暂无好友，<a href="/friends" className="text-blue-500 hover:underline">去添加好友</a>
                </p>
              ) : (
                <div className="max-h-40 overflow-y-auto space-y-2">
                  {friends.filter(f => f.status === 'online').map(friend => (
                    <div key={friend.id} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg">
                      <div className="flex items-center gap-2">
                        <div className="relative">
                          <img 
                            src={friend.avatar || '/default-avatar.png'} 
                            alt="" 
                            className="w-8 h-8 rounded-full"
                          />
                          <span className="absolute bottom-0 right-0 w-2 h-2 bg-green-500 rounded-full"></span>
                        </div>
                        <span className="text-sm font-medium">{friend.nickname}</span>
                        <span className="text-xs text-gray-500">{friend.score}分</span>
                      </div>
                      <button
                        onClick={() => handleInviteFriend(friend)}
                        className="px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600"
                      >
                        邀请
                      </button>
                    </div>
                  ))}
                  {friends.filter(f => f.status === 'online').length === 0 && (
                    <p className="text-gray-500 text-sm text-center py-2">暂无在线好友</p>
                  )}
                </div>
              )}
            </div>

            <button
              onClick={() => navigate('/')}
              className="btn-secondary w-full py-3 mt-4"
            >
              返回大厅
            </button>
          </>
        ) : (
          <>
            {/* 匹配中 */}
            <div className="py-8 text-center">
              <div className="relative w-24 h-24 mx-auto mb-6">
                <div className="absolute inset-0 border-4 border-gray-200 rounded-full"></div>
                <div className="absolute inset-0 border-4 border-t-gray-900 rounded-full animate-spin"></div>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-2xl">⚫⚪</span>
                </div>
              </div>

              {waitingForFriend ? (
                <>
                  <h2 className="text-xl font-bold mb-2">等待好友响应...</h2>
                  <p className="text-gray-600 mb-4">
                    已向 <span className="font-bold">{selectedFriend?.nickname}</span> 发送邀请
                  </p>
                </>
              ) : (
                <>
                  <h2 className="text-xl font-bold mb-2">正在匹配对手...</h2>
                  <p className="text-sm text-gray-500 mb-2">
                    模式: {matchMode === 'random' ? '随机' : matchMode === 'normal' ? '普通' : matchMode === 'easy' ? '入门' : '高手'}
                  </p>
                  <p className="text-3xl font-mono text-gray-600 mb-2">
                    {formatTime(matchTime)}
                  </p>
                </>
              )}
              
              <p className="text-sm text-gray-400 mb-6">
                棋盘大小: 19×19
              </p>

              <button
                onClick={handleCancelMatching}
                className="btn-secondary w-full py-3"
              >
                取消匹配
              </button>
            </div>

            {/* 超时对话框 */}
            {showTimeoutDialog && (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                <div className="bg-white rounded-2xl p-6 max-w-sm w-full text-center">
                  <div className="text-4xl mb-4">⏰</div>
                  <h3 className="text-lg font-bold mb-2">匹配超时</h3>
                  <p className="text-gray-600 mb-6">
                    已等待超过1分钟，暂时没有找到合适的对手。是否继续等待？
                  </p>
                  <div className="flex gap-3">
                    <button
                      onClick={handleContinueMatching}
                      className="btn-primary flex-1"
                    >
                      继续等待
                    </button>
                    <button
                      onClick={handleGiveUpMatching}
                      className="btn-secondary flex-1"
                    >
                      返回大厅
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* 好友邀请弹窗 */}
        {pendingInvite && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl p-6 max-w-sm w-full text-center">
              <div className="text-4xl mb-4">🎮</div>
              <h3 className="text-lg font-bold mb-2">收到对战邀请</h3>
              <p className="text-gray-600 mb-4">
                <span className="font-bold">{pendingInvite.fromName}</span> 邀请你进行围棋对战
              </p>
              <p className="text-sm text-gray-500 mb-4">
                对方积分: {pendingInvite.fromScore}
              </p>
              <div className="flex gap-3">
                <button
                  onClick={handleAcceptInvite}
                  className="btn-success flex-1"
                >
                  接受邀请
                </button>
                <button
                  onClick={handleRejectInvite}
                  className="btn-secondary flex-1"
                >
                  拒绝
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 提示 */}
        <p className="text-xs text-gray-400 mt-6 text-center">
          积分要求：{MIN_SCORE_FOR_PVP} 分以上才能参与在线对战
        </p>
      </div>
    </div>
  )
}

export default Matching
