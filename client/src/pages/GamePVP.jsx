import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { useGameStore } from '../store/gameStore'
import socketService from '../services/socket'
import GoBoard from '../components/GoBoard'

const TURN_TIME_LIMIT = 180 // 3分钟

const GamePVP = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, token, updateUser } = useAuthStore()
  const gameStore = useGameStore()
  
  // 优先从 location.state 获取，否则从 sessionStorage 恢复
  const getInitialRoomInfo = () => {
    if (location.state) {
      // 保存到 sessionStorage 以便重连时恢复
      sessionStorage.setItem('pvp_room_info', JSON.stringify(location.state))
      return location.state
    }
    // 尝试从 sessionStorage 恢复
    const saved = sessionStorage.getItem('pvp_room_info')
    return saved ? JSON.parse(saved) : null
  }
  
  const [roomInfo, setRoomInfo] = useState(getInitialRoomInfo)
  const [playerColor, setPlayerColor] = useState(null)
  const [opponentDisconnected, setOpponentDisconnected] = useState(false)
  const [disconnectTimeout, setDisconnectTimeout] = useState(0)
  const [opponentStatus, setOpponentStatus] = useState('online')
  const [showDrawRequest, setShowDrawRequest] = useState(false)
  const [drawRequester, setDrawRequester] = useState(null)
  const [showResult, setShowResult] = useState(false)
  const [gameResult, setGameResult] = useState(null)
  const [chatMessages, setChatMessages] = useState([])
  const [chatInput, setChatInput] = useState('')
  const [showChat, setShowChat] = useState(false)
  const [turnTimeRemaining, setTurnTimeRemaining] = useState(TURN_TIME_LIMIT)
  const [autoMoveMessage, setAutoMoveMessage] = useState('')
  const [unreadCount, setUnreadCount] = useState(0)  // 未读消息数量
  const [chatFlashing, setChatFlashing] = useState(false)  // 聊天按钮闪烁状态
  const disconnectTimerRef = useRef(null)
  const showChatRef = useRef(false)  // 用于在回调中访问最新的showChat状态
  const initializedRef = useRef(false) // 防止重载房间时反复清空棋盘

  const { 
    board,
    currentTurn,
    moves,
    capturedByBlack,
    capturedByWhite,
    initBoard,
    receiveMove,
    setGameInfo,
    resetGame
  } = gameStore

  // 初始化游戏
  useEffect(() => {
    if (!roomInfo || !token) {
      // 如果没有房间信息，检查是否有保存的对局
      const savedRoomInfo = sessionStorage.getItem('pvp_room_info')
      if (!savedRoomInfo) {
        navigate('/matching')
        return
      }
    }

    const isRestoring = (location.state?.reconnect) || (!location.state && sessionStorage.getItem('pvp_room_info'))
    
    // 连接Socket
    const socket = socketService.connect(token)

    // 仅首次进房时初始化棋盘，避免状态重置
    if (!initializedRef.current && roomInfo?.boardSize) {
      initBoard(roomInfo.boardSize)

      // 确定玩家颜色
      if (roomInfo.blackPlayer && roomInfo.blackPlayer.id === user.id) {
        setPlayerColor('black')
      } else if (roomInfo.whitePlayer && roomInfo.whitePlayer.id === user.id) {
        setPlayerColor('white')
      }
      initializedRef.current = true
    }

    // 监听Socket事件
    setupSocketListeners()

    // 如果是恢复模式，立即尝试重连
    if (isRestoring && socketService.isConnected()) {
      console.log('检测到恢复状态，尝试重连对局...', roomInfo)
      socketService.emit('reconnect_game', { 
        roomId: roomInfo.roomId, 
        gameId: roomInfo.gameId 
      })
    }

    // 监听 Socket 重连事件，重连后尝试恢复游戏
    const handleReconnect = () => {
      console.log('Socket 重连成功，尝试恢复游戏状态...')
      socketService.emit('reconnect_game', { 
        roomId: roomInfo.roomId, 
        gameId: roomInfo.gameId 
      })
    }
    
    if (socket) {
      socket.on('connect', handleReconnect)
    }

    return () => {
      cleanupSocketListeners()
      if (socket) {
        socket.off('connect', handleReconnect)
      }
    }
  }, [roomInfo?.roomId, roomInfo?.gameId, roomInfo?.boardSize, token])

  // 同步 showChat 状态到 ref
  useEffect(() => {
    showChatRef.current = showChat
  }, [showChat])

  const setupSocketListeners = useCallback(() => {
    // 监听对手落子
    socketService.on('stone_placed', (data) => {
      const { x, y, color, captured, nextTurn, moveNumber } = data
      
      // 如果不是自己的落子，更新棋盘 (增加 moveNumber 校验)
      if (color !== playerColor) {
        receiveMove(x, y, color, captured, moveNumber)
      }
      
      setGameInfo({ currentTurn: nextTurn })
      setTurnTimeRemaining(TURN_TIME_LIMIT)
    })

    // 监听游戏结束
    socketService.on('game_ended', (data) => {
      setGameResult(data)
      setShowResult(true)
      
      // 游戏结束，清理保存的房间信息
      sessionStorage.removeItem('pvp_room_info')
      
      // 使用后端返回的实际分数变化更新用户信息
      if (data.scoreDeltas && data.scoreDeltas[user.id] !== undefined) {
        updateUser({ score: user.score + data.scoreDeltas[user.id] })
      }
    })

    // 监听重连失败
    socketService.on('reconnect_failed', (data) => {
      console.warn('PVP重连被拒绝:', data.message)
      alert(data.message || '该对局已结束')
      sessionStorage.removeItem('pvp_room_info')
      navigate('/')
    })

    // 监听对手断线
    socketService.on('opponent_disconnected', (data) => {
      setOpponentDisconnected(true)
      setOpponentStatus('offline')
      setDisconnectTimeout(data.timeout)
      setAutoMoveMessage(data.message || `对方网络突然断开，${data.timeout}秒后将判定您获胜`)
      
      // 倒计时
      if (disconnectTimerRef.current) {
        clearInterval(disconnectTimerRef.current)
      }
      disconnectTimerRef.current = setInterval(() => {
        setDisconnectTimeout(prev => {
          if (prev <= 1) {
            clearInterval(disconnectTimerRef.current)
            return 0
          }
          return prev - 1
        })
      }, 1000)
    })

    // 监听对手切后台
    socketService.on('opponent_status_change', (data) => {
      if (data.status === 'away') {
        setOpponentStatus('away')
        setAutoMoveMessage(data.message || '对手已将应用切至后台，等待其操作...')
      }
    })

    // 监听对手重连
    socketService.on('opponent_reconnected', () => {
      setOpponentDisconnected(false)
      setOpponentStatus('online')
      setDisconnectTimeout(0)
      setAutoMoveMessage('对手已回到前台/已连回')
      if (disconnectTimerRef.current) {
        clearInterval(disconnectTimerRef.current)
      }
      setTimeout(() => setAutoMoveMessage(''), 3000)
    })

    // 监听和棋请求
    socketService.on('draw_requested', (data) => {
      setDrawRequester(data.from)
      setShowDrawRequest(true)
    })

    // 监听和棋被拒绝
    socketService.on('draw_rejected', () => {
      alert('对手拒绝了和棋请求')
    })

    // 监听PASS
    socketService.on('player_passed', (data) => {
      const { color, nextTurn } = data
      gameStore.addPassMove(color)
      setGameInfo({ currentTurn: nextTurn })
      setTurnTimeRemaining(TURN_TIME_LIMIT)
    })

    // 监听回合时间更新
    socketService.on('turn_time_update', (data) => {
      setTurnTimeRemaining(data.remaining)
    })

    // 监听自动落子
    socketService.on('auto_stone_placed', (data) => {
      const { x, y, color, captured, nextTurn, moveNumber, message } = data
      receiveMove(x, y, color, captured, moveNumber)
      setGameInfo({ currentTurn: nextTurn })
      setAutoMoveMessage(message)
      setTurnTimeRemaining(TURN_TIME_LIMIT)
      // 3秒后清除消息
      setTimeout(() => setAutoMoveMessage(''), 3000)
    })

    // 监听自动PASS
    socketService.on('auto_pass', (data) => {
      const { color, nextTurn, message } = data
      gameStore.addPassMove(color)
      setGameInfo({ currentTurn: nextTurn })
      setAutoMoveMessage(message)
      setTurnTimeRemaining(TURN_TIME_LIMIT)
      setTimeout(() => setAutoMoveMessage(''), 3000)
    })

    // 监听聊天消息
    socketService.on('chat_message', (data) => {
      setChatMessages(prev => [...prev, data])
      // 如果聊天窗口关闭，增加未读消息数并触发闪烁
      if (!showChatRef.current) {
        setUnreadCount(prev => prev + 1)
        // 触发闪烁动画
        setChatFlashing(true)
        // 闪烁动画1.5秒后停止
        setTimeout(() => setChatFlashing(false), 1500)
      }
    })

    // 监听游戏状态同步（重连时）
    socketService.on('game_state', (data) => {
      console.log('收到游戏状态同步:', data)
      setGameInfo({
        board: data.board,
        moves: data.moves,
        currentTurn: data.currentTurn
      })
      setPlayerColor(data.yourColor)
      setTurnTimeRemaining(TURN_TIME_LIMIT)
      
      // 更新 roomInfo（可能从数据库恢复了玩家信息）
      if (data.players) {
        const blackPlayer = data.players.find(p => p.color === 'black')
        const whitePlayer = data.players.find(p => p.color === 'white')
        setRoomInfo(prev => ({
          ...prev,
          blackPlayer: blackPlayer || prev?.blackPlayer,
          whitePlayer: whitePlayer || prev?.whitePlayer
        }))
      }
    })



    // 监听错误
    socketService.on('game_error', (data) => {
      console.error('游戏错误:', data.message)
      if (data.message && (data.message.includes('不存在') || data.message.includes('已结束'))) {
        alert(data.message)
        sessionStorage.removeItem('pvp_room_info')
        navigate('/')
      }
    })
  }, [playerColor, receiveMove, setGameInfo, user.id, updateUser, navigate])

  const cleanupSocketListeners = () => {
    socketService.off('stone_placed')
    socketService.off('game_ended')
    socketService.off('opponent_disconnected')
    socketService.off('opponent_status_change')
    socketService.off('opponent_reconnected')
    socketService.off('draw_requested')
    socketService.off('draw_rejected')
    socketService.off('player_passed')
    socketService.off('chat_message')
    socketService.off('game_state')
    socketService.off('reconnect_failed')
    socketService.off('game_state')
    socketService.off('game_error')
    socketService.off('turn_time_update')
    socketService.off('auto_stone_placed')
    socketService.off('auto_pass')
    if (disconnectTimerRef.current) {
      clearInterval(disconnectTimerRef.current)
    }
  }

  const isPlayerTurn = currentTurn === playerColor

  // 落子
  const handlePlaceStone = (x, y) => {
    if (!isPlayerTurn || !roomInfo) return

    // 本地验证
    const result = gameStore.placeStone(x, y)
    if (result.success) {
      // 发送到服务器
      socketService.placeStone(roomInfo.roomId, x, y)
    }
  }

  // PASS
  const handlePass = () => {
    if (!isPlayerTurn || !roomInfo) return
    socketService.pass(roomInfo.roomId)
  }

  // 认输
  const handleResign = () => {
    if (!roomInfo) return
    if (confirm('确定要认输吗？')) {
      socketService.resign(roomInfo.roomId)
    }
  }

  // 请求和棋
  const handleRequestDraw = () => {
    if (!roomInfo) return
    socketService.requestDraw(roomInfo.roomId)
    alert('已发送和棋请求，等待对手回应')
  }

  // 接受和棋
  const handleAcceptDraw = () => {
    if (!roomInfo) return
    socketService.acceptDraw(roomInfo.roomId)
    setShowDrawRequest(false)
  }

  // 拒绝和棋
  const handleRejectDraw = () => {
    if (!roomInfo) return
    socketService.rejectDraw(roomInfo.roomId)
    setShowDrawRequest(false)
  }

  // 发送聊天消息
  const handleSendChat = (e) => {
    e.preventDefault()
    if (!chatInput.trim() || !roomInfo) return
    
    socketService.sendChatMessage(roomInfo.roomId, chatInput.trim())
    setChatInput('')
  }

  // 返回
  const handleBack = () => {
    if (!showResult) {
      if (!confirm('游戏进行中，离开将判负。确定要离开吗？')) return
    }
    resetGame()
    navigate('/')
  }

  // 获取最后一手
  const lastMove = moves.length > 0 ? moves[moves.length - 1] : null

  // 获取对手信息
  const opponent = roomInfo 
    ? (playerColor === 'black' ? roomInfo.whitePlayer : roomInfo.blackPlayer)
    : null

  if (!roomInfo) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="loading-spinner w-8 h-8 border-4 border-gray-300 border-t-gray-900 rounded-full"></div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      {/* 顶部信息栏 */}
      <div className="bg-gray-900 text-white px-4 py-3">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <button onClick={handleBack} className="text-gray-400 hover:text-white">
            ← 返回
          </button>
          <div className="text-center">
            <span className="text-sm text-gray-400">网络对战</span>
            <span className="mx-2">·</span>
            <span className="text-sm">{roomInfo.boardSize}×{roomInfo.boardSize}</span>
          </div>
          <button 
            onClick={() => {
              setShowChat(!showChat)
              // 打开聊天窗口时清除未读消息数
              if (!showChat) {
                setUnreadCount(0)
                setChatFlashing(false)
              }
            }}
            className={`relative transition-colors ${
              chatFlashing 
                ? 'text-red-500 chat-flash' 
                : unreadCount > 0 
                  ? 'text-red-400' 
                  : 'text-gray-400 hover:text-white'
            }`}
          >
            💬 {unreadCount > 0 && (
              <span className={`text-xs ml-1 ${chatFlashing ? 'text-red-500 font-bold' : 'text-red-400'}`}>
                ({unreadCount})
              </span>
            )}
          </button>
        </div>
      </div>

      {/* 对手断线提示 */}
      {opponentDisconnected && opponentStatus === 'offline' && (
        <div className="bg-red-500 text-white text-center py-3 animate-pulse">
          ⚠️ 对手网络突然断开，{disconnectTimeout}秒后未能连回将判定您获胜
        </div>
      )}

      {/* 对手切后台提示 */}
      {opponentStatus === 'away' && (
        <div className="bg-yellow-500 text-white text-center py-3">
          📱 对手已将应用切至后台，对局仍在继续，等待其返回...
        </div>
      )}

      {/* 超时自动落子提示或其他消息 */}
      {autoMoveMessage && opponentStatus !== 'offline' && opponentStatus !== 'away' && (
        <div className="bg-yellow-500 text-white text-center py-2">
          ⏰ {autoMoveMessage}
        </div>
      )}

      {/* 玩家信息 + 倒计时 */}
      <div className="bg-white shadow px-4 py-3">
        <div className="max-w-4xl mx-auto">
          {/* 回合倒计时 */}
          <div className="flex justify-center mb-3">
            <div className={`px-4 py-2 rounded-full text-sm font-mono ${
              turnTimeRemaining <= 30 
                ? 'bg-red-100 text-red-600 animate-pulse' 
                : turnTimeRemaining <= 60 
                  ? 'bg-yellow-100 text-yellow-600' 
                  : 'bg-gray-100 text-gray-600'
            }`}>
              ⏱️ 剩余时间: {Math.floor(turnTimeRemaining / 60)}:{(turnTimeRemaining % 60).toString().padStart(2, '0')}
              {turnTimeRemaining <= 30 && <span className="ml-2">⚠️</span>}
            </div>
          </div>
          
          <div className="flex items-center justify-between">
            {/* 黑方 */}
            <div className={`flex items-center gap-3 ${currentTurn === 'black' ? 'opacity-100' : 'opacity-50'}`}>
              <span className="text-2xl">⚫</span>
              <div>
                <p className="font-bold">
                  {roomInfo?.blackPlayer?.nickname || '正在加载...'}
                  {playerColor === 'black' && <span className="text-xs text-blue-500 ml-1">(你)</span>}
                </p>
                <p className="text-sm text-gray-500">提子: {capturedByBlack}</p>
              </div>
              {currentTurn === 'black' && (
                <span className="px-2 py-1 bg-green-100 text-green-600 text-xs rounded">
                  {isPlayerTurn ? '你的回合' : '对方回合'}
                </span>
              )}
            </div>

            <div className="text-gray-400 text-sm">
              第 {moves.length} 手
            </div>

            {/* 白方 */}
            <div className={`flex items-center gap-3 ${currentTurn === 'white' ? 'opacity-100' : 'opacity-50'}`}>
              {currentTurn === 'white' && (
                <span className="px-2 py-1 bg-green-100 text-green-600 text-xs rounded">
                  {isPlayerTurn ? '你的回合' : '对方回合'}
                </span>
              )}
              <div className="text-right">
                <p className="font-bold">
                  {roomInfo?.whitePlayer?.nickname || '正在加载...'}
                  {playerColor === 'white' && <span className="text-xs text-blue-500 ml-1">(你)</span>}
                </p>
                <p className="text-sm text-gray-500">提子: {capturedByWhite}</p>
              </div>
              <span className="text-2xl">⚪</span>
            </div>
          </div>
        </div>
      </div>

      {/* 棋盘 */}
      <div className="flex-1 flex items-center justify-center p-4">
        <GoBoard
          size={roomInfo.boardSize}
          board={board}
          onPlaceStone={handlePlaceStone}
          disabled={!isPlayerTurn}
          currentTurn={currentTurn}
          playerColor={playerColor}
          lastMove={lastMove}
        />
      </div>

      {/* 底部操作栏 */}
      <div className="bg-white shadow-lg px-4 py-4 pb-safe">
        <div className="max-w-4xl mx-auto flex justify-center gap-3">
          <button
            onClick={handlePass}
            disabled={!isPlayerTurn}
            className="btn-secondary"
          >
            PASS
          </button>
          <button
            onClick={handleRequestDraw}
            className="btn-secondary"
          >
            求和
          </button>
          <button
            onClick={handleResign}
            className="btn-danger"
          >
            认输
          </button>
        </div>
      </div>

      {/* 聊天窗口 */}
      {showChat && (
        <div className="fixed bottom-20 right-4 w-80 bg-white rounded-lg shadow-xl z-40 flex flex-col max-h-96">
          <div className="p-3 border-b flex justify-between items-center">
            <span className="font-bold">对局聊天</span>
            <button onClick={() => setShowChat(false)} className="text-gray-400 hover:text-gray-600">✕</button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2 min-h-[200px]">
            {chatMessages.map((msg, index) => (
              <div 
                key={index}
                className={`flex ${msg.from.id === user.id ? 'justify-end' : 'justify-start'}`}
              >
                <div className={`max-w-[80%] rounded-lg px-3 py-2 ${
                  msg.from.id === user.id 
                    ? 'bg-gray-900 text-white' 
                    : 'bg-gray-100 text-gray-800'
                }`}>
                  <p className="text-xs opacity-70 mb-1">{msg.from.nickname}</p>
                  <p className="text-sm">{msg.message}</p>
                </div>
              </div>
            ))}
          </div>
          <form onSubmit={handleSendChat} className="p-3 border-t flex gap-2">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="输入消息..."
              className="input flex-1"
              maxLength={200}
            />
            <button type="submit" className="btn-primary px-4">发送</button>
          </form>
        </div>
      )}

      {/* 和棋请求弹窗 */}
      {showDrawRequest && drawRequester && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full text-center">
            <h2 className="text-xl font-bold mb-4">和棋请求</h2>
            <p className="text-gray-600 mb-6">
              {drawRequester.nickname} 请求和棋
            </p>
            <div className="flex gap-3">
              <button onClick={handleAcceptDraw} className="btn-success flex-1">
                接受
              </button>
              <button onClick={handleRejectDraw} className="btn-secondary flex-1">
                拒绝
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 结果弹窗 */}
      {showResult && gameResult && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-8 max-w-sm w-full text-center">
            <div className="text-6xl mb-4">
              {gameResult.winnerId === user.id ? '🎉' : 
               gameResult.winnerId === null ? '🤝' : '😔'}
            </div>
            <h2 className="text-2xl font-bold mb-2">
              {gameResult.winnerId === user.id ? '恭喜获胜！' : 
               gameResult.winnerId === null ? '握手言和' : '很遗憾，再接再厉！'}
            </h2>
            <p className="text-gray-600 mb-2">{gameResult.result}</p>
            {/* 显示实际积分变化 */}
            {gameResult.scoreDeltas && gameResult.scoreDeltas[user.id] !== undefined && (
              <p className={`text-lg font-bold mb-2 ${
                gameResult.scoreDeltas[user.id] > 0 ? 'text-green-600' : 
                gameResult.scoreDeltas[user.id] < 0 ? 'text-red-600' : 'text-gray-600'
              }`}>
                积分 {gameResult.scoreDeltas[user.id] > 0 ? '+' : ''}{gameResult.scoreDeltas[user.id]}
              </p>
            )}
            <p className="text-sm text-gray-400 mb-6">
              共 {gameResult.moves} 手，用时 {Math.floor(gameResult.duration / 60)}:{(gameResult.duration % 60).toString().padStart(2, '0')}
            </p>
            
            <div className="flex gap-3">
              <button
                onClick={() => navigate('/matching')}
                className="btn-primary flex-1"
              >
                再来一局
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
      )}
    </div>
  )
}

export default GamePVP
