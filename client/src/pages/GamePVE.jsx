import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { useGameStore } from '../store/gameStore'
import { gameAPI } from '../services/api'
import socketService from '../services/socket'
import GoBoard from '../components/GoBoard'

// 导入AI Worker
import GoAI from '../utils/goAI'

const GamePVE = () => {
  const navigate = useNavigate()
  const { user, updateUser } = useAuthStore()
  const gameStore = useGameStore()
  
  const [gameStarted, setGameStarted] = useState(false)
  const [aiLevel, setAiLevel] = useState('easy')
  const [boardSize, setBoardSize] = useState(19)
  const [playAsBlack, setPlayAsBlack] = useState(true)
  const [aiThinking, setAiThinking] = useState(false)
  const [gameId, setGameId] = useState(null)
  const [startTime, setStartTime] = useState(null)
  const [showResult, setShowResult] = useState(false)
  const [aiNeedsFirstMove, setAiNeedsFirstMove] = useState(false)
  const [socketDisconnected, setSocketDisconnected] = useState(false)
  const [disconnectCountdown, setDisconnectCountdown] = useState(30)
  const gameStartedRef = useRef(false)
  const disconnectTimerRef = useRef(null)

  const { 
    board, 
    currentTurn, 
    gameStatus, 
    gameResult,
    capturedByBlack,
    capturedByWhite,
    moves,
    initBoard,
    placeStone,
    pass,
    resign,
    resetGame
  } = gameStore

  const playerColor = playAsBlack ? 'black' : 'white'
  const aiColor = playAsBlack ? 'white' : 'black'
  const isPlayerTurn = currentTurn === playerColor

  // 开始游戏
  // 组件卸载和 Socket 监听，以及恢复缓存
  useEffect(() => {
    // 检查是否有未完成的对局存档
    const savedState = localStorage.getItem('pve_game_state')
    let shouldRecover = false
    if (savedState) {
      try {
        const parsed = JSON.parse(savedState)
        const timeDiff = Date.now() - parsed.lastUpdateTime
        
        // 如果断开时间小于30秒且仍在进行中，则恢复状态
        if (timeDiff <= 30000 && parsed.gameStatus === 'playing') {
          shouldRecover = true
          setAiLevel(parsed.aiLevel)
          setBoardSize(parsed.boardSize)
          setPlayAsBlack(parsed.playAsBlack)
          setGameId(parsed.gameId)
          setStartTime(parsed.startTime)
          
          gameStore.setGameInfo({
            boardSize: parsed.boardSize,
            board: parsed.board,
            moves: parsed.moves,
            currentTurn: parsed.currentTurn,
            gameStatus: parsed.gameStatus,
            capturedByBlack: parsed.capturedByBlack,
            capturedByWhite: parsed.capturedByWhite,
            gameResult: null
          })
          
          setGameStarted(true)
          gameStartedRef.current = true
          socketService.emit('pve_start') // 通知处于对局中
        } else {
          // 超时被判定负或结束
          localStorage.removeItem('pve_game_state')
          if (parsed.gameStatus === 'playing') {
             const humanColor = parsed.playAsBlack ? 'black' : 'white'
             const duration = Math.floor((Date.now() - parsed.startTime) / 1000)
             
             // 静默提交逃跑判负
             if (parsed.gameId) {
               gameAPI.finishPVE(
                 parsed.gameId,
                 null, // AI 获胜，玩家没有 userId
                 parsed.moves,
                 `${humanColor === 'black' ? '黑方' : '白方'}离开超过30秒，系统判定认输`,
                 duration
               ).catch(console.error)
             }
             
             setTimeout(() => alert('您先前的对局已断连超时（超过30秒），对局已被系统结算为负。'), 500)
          }
        }
      } catch(e) {
        localStorage.removeItem('pve_game_state')
      }
    }

    const socket = socketService.getSocket()
    
    const handleDisconnect = () => {
      // 只有在游戏进行中且真正断开时才提示
      if (gameStartedRef.current && useGameStore.getState().gameStatus === 'playing') {
        console.log('PVE 对局中 Socket 断开')
        setSocketDisconnected(true)
        setDisconnectCountdown(30)
        
        if (disconnectTimerRef.current) clearInterval(disconnectTimerRef.current)
        disconnectTimerRef.current = setInterval(() => {
          setDisconnectCountdown(prev => {
            if (prev <= 1) {
              clearInterval(disconnectTimerRef.current)
              alert('网络断开超时，系统判定您已自动断线认输。')
              setSocketDisconnected(false)
              gameStartedRef.current = false
              
              // 取出离线的玩家执子颜色
              const saved = localStorage.getItem('pve_game_state')
              let humanColor = 'black'
              if (saved) {
                try {
                  humanColor = JSON.parse(saved).playAsBlack ? 'black' : 'white'
                } catch(e) {}
              }
              
              localStorage.removeItem('pve_game_state')
              
              // 主动触发认输，利用已有的 useEffect 自动结算对局和上传战绩
              useGameStore.getState().resign(humanColor)
              return 0
            }
            return prev - 1
          })
        }, 1000)
      }
    }

    const handleConnect = () => {
      setSocketDisconnected(false)
      if (disconnectTimerRef.current) {
        clearInterval(disconnectTimerRef.current)
      }
    }

    if (socket) {
      socket.on('disconnect', handleDisconnect)
      socket.on('connect', handleConnect)
    }

    return () => {
      // 组件卸载时，只有游戏真正开始过才发送 pve_end
      if (gameStartedRef.current && socketService.isConnected()) {
        socketService.emit('pve_end')
        console.log('PVE 组件卸载，游戏已开始，发送 pve_end')
      }
      if (socket) {
        socket.off('disconnect', handleDisconnect)
        socket.off('connect', handleConnect)
      }
      if (disconnectTimerRef.current) {
        clearInterval(disconnectTimerRef.current)
      }
    }
  }, [navigate])

  // 监听游戏状态并随时进行存档
  useEffect(() => {
    if (gameStarted && gameStatus === 'playing') {
      localStorage.setItem('pve_game_state', JSON.stringify({
        aiLevel, boardSize, playAsBlack, gameId, startTime,
        board, moves, currentTurn, gameStatus, capturedByBlack, capturedByWhite,
        lastUpdateTime: Date.now()
      }))
    } else if (gameStatus === 'finished' || !gameStarted) {
      localStorage.removeItem('pve_game_state')
    }
  }, [board, moves, gameStatus, gameStarted, aiLevel, boardSize, playAsBlack, gameId, startTime, capturedByBlack, capturedByWhite, currentTurn])

  const handleStartGame = async () => {
    try {
      // 创建对局记录
      const response = await gameAPI.createPVE(aiLevel, boardSize, playAsBlack)
      setGameId(response.data.data.gameId)
      
      // 初始化棋盘
      initBoard(boardSize)
      setGameStarted(true)
      gameStartedRef.current = true
      setStartTime(Date.now())

      // 通知服务器开始PVE，设置用户状态为playing
      socketService.emit('pve_start')

      // 如果AI先手（玩家执白），让AI下棋
      // 使用标记让 useEffect 触发AI首手
      if (!playAsBlack) {
        // 设置需要AI首手的标记
        setAiNeedsFirstMove(true)
      }
    } catch (error) {
      console.error('创建对局失败:', error)
      alert('创建对局失败，请重试')
    }
  }

  // AI下棋
  const aiMove = async () => {
    if (gameStatus !== 'playing') return

    setAiThinking(true)

    try {
      let move

      if (aiLevel === 'hard') {
        // 大模型AI使用异步调用
        console.log('开始大模型AI思考...')
        move = await GoAI.getMoveAsync(board, aiColor, aiLevel, boardSize)
        console.log('大模型AI返回着法:', move)
      } else {
        // 普通AI使用同步调用
        move = GoAI.getMove(board, aiColor, aiLevel, boardSize)
      }

      if (!move) {
        console.error('AI返回空着法，强制PASS')
        pass()
        setAiThinking(false)
        return
      }

      if (move.pass) {
        console.log('AI选择PASS')
        pass()
      } else if (typeof move.x === 'number' && typeof move.y === 'number') {
        console.log(`AI尝试落子: (${move.x}, ${move.y})`)
        const result = placeStone(move.x, move.y)
        if (!result.success) {
          console.warn('AI落子失败:', result.message, '尝试PASS')
          // 记录失败的着法，避免重复尝试
          console.warn(`AI落子(${move.x}, ${move.y})失败，原因: ${result.message}`)
          pass()
        } else {
          console.log(`AI成功落子: (${move.x}, ${move.y})`)
        }
      } else {
        console.error('AI返回无效着法格式:', move, '强制PASS')
        pass()
      }
    } catch (error) {
      console.error('AI计算严重错误:', error)
      // AI出错时自动PASS，并显示错误信息
      pass()

      // 在大模型出错时显示提示
      if (aiLevel === 'hard') {
        console.warn('大模型AI出错，可能正在使用降级策略')
      }
    } finally {
      setAiThinking(false)
    }
  }

  // 玩家落子
  const handlePlaceStone = (x, y) => {
    if (!isPlayerTurn || aiThinking || gameStatus !== 'playing') return

    const result = placeStone(x, y)
    if (result.success) {
      // 玩家落子后，轮到AI
      setTimeout(() => aiMove(), 300)
    }
  }

  // 玩家PASS
  const handlePass = () => {
    if (!isPlayerTurn || aiThinking || gameStatus !== 'playing') return
    
    const result = pass()
    if (!result.gameEnded) {
      setTimeout(() => aiMove(), 300)
    }
  }

  // 玩家认输
  const handleResign = () => {
    if (gameStatus !== 'playing') return
    
    if (confirm('确定要认输吗？')) {
      resign(playerColor)
    }
  }

  // AI首手处理 - 当玩家执白时，等待gameStatus变为playing后再触发AI
  useEffect(() => {
    if (aiNeedsFirstMove && gameStatus === 'playing') {
      setAiNeedsFirstMove(false)
      setTimeout(() => aiMove(), 500)
    }
  }, [aiNeedsFirstMove, gameStatus])

  // 游戏结束处理
  useEffect(() => {
    if (gameStatus === 'finished' && gameResult && gameId) {
      setShowResult(true)
      saveGameResult()
    }
  }, [gameStatus, gameResult])

  // 保存游戏结果
  const saveGameResult = async () => {
    if (!gameId || !gameResult) return

    const duration = Math.floor((Date.now() - startTime) / 1000)
    const winnerId = gameResult.winner === playerColor ? user.id : null

    try {
      const response = await gameAPI.finishPVE(
        gameId,
        winnerId,
        moves,
        gameResult.description,
        duration
      )
      
      // 更新用户积分
      if (response.data.data.scoreDelta) {
        updateUser({ score: user.score + response.data.data.scoreDelta })
      }
    } catch (error) {
      console.error('保存对局结果失败:', error)
    }
  }

  // 返回大厅
  const handleBack = () => {
    if (gameStatus === 'playing') {
      if (!confirm('游戏进行中，确定要退出吗？')) return
    }
    // 通知服务器结束PVE，恢复用户状态为online
    socketService.emit('pve_end')
    gameStartedRef.current = false
    resetGame()
    navigate('/')
  }

  // 再来一局
  const handlePlayAgain = () => {
    // 通知服务器结束当前PVE（准备重新开始）
    socketService.emit('pve_end')
    gameStartedRef.current = false
    resetGame()
    setGameStarted(false)
    setShowResult(false)
    setGameId(null)
  }

  // 获取最后一手
  const lastMove = moves.length > 0 ? moves[moves.length - 1] : null

  if (!gameStarted) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full">
          <h1 className="text-2xl font-bold text-center mb-6">🤖 人机对弈</h1>
          
          {/* AI难度选择 */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              AI难度
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { value: 'easy', label: '初级', icon: '🌱' },
                { value: 'medium', label: '中级', icon: '🌿' },
                { value: 'hard', label: '大模型', icon: '🤖' }
              ].map(level => (
                <button
                  key={level.value}
                  onClick={() => setAiLevel(level.value)}
                  className={`p-3 rounded-lg border-2 transition-all ${
                    aiLevel === level.value 
                      ? 'border-gray-900 bg-gray-900 text-white' 
                      : 'border-gray-200 hover:border-gray-400'
                  }`}
                >
                  <span className="text-xl">{level.icon}</span>
                  <p className="text-sm mt-1">{level.label}</p>
                </button>
              ))}
            </div>
          </div>

          {/* 棋盘大小 - 固定19x19标准棋盘 */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              棋盘大小
            </label>
            <div className="p-3 rounded-lg border-2 border-gray-900 bg-gray-900 text-white text-center">
              19×19 标准棋盘
            </div>
          </div>

          {/* 执子选择 */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              执子
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setPlayAsBlack(true)}
                className={`p-3 rounded-lg border-2 transition-all flex items-center justify-center gap-2 ${
                  playAsBlack 
                    ? 'border-gray-900 bg-gray-900 text-white' 
                    : 'border-gray-200 hover:border-gray-400'
                }`}
              >
                <span className="text-xl">⚫</span>
                <span>执黑先行</span>
              </button>
              <button
                onClick={() => setPlayAsBlack(false)}
                className={`p-3 rounded-lg border-2 transition-all flex items-center justify-center gap-2 ${
                  !playAsBlack 
                    ? 'border-gray-900 bg-gray-900 text-white' 
                    : 'border-gray-200 hover:border-gray-400'
                }`}
              >
                <span className="text-xl">⚪</span>
                <span>执白后行</span>
              </button>
            </div>
          </div>

          {/* 开始按钮 */}
          <button
            onClick={handleStartGame}
            className="btn-primary w-full py-3 text-lg"
          >
            开始对局
          </button>

          <button
            onClick={() => navigate('/')}
            className="btn-secondary w-full py-3 mt-3"
          >
            返回
          </button>
        </div>
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
            <span className="text-sm text-gray-400">人机对弈</span>
            <span className="mx-2">·</span>
            <span className="text-sm">
              {aiLevel === 'easy' ? '初级' : aiLevel === 'medium' ? '中级' : '大模型'}
            </span>
          </div>
          <div className="text-sm text-gray-400">
            第 {moves.length} 手
          </div>
        </div>
      </div>

      {/* 玩家信息 */}
      <div className="bg-white shadow px-4 py-3">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          {/* 玩家 */}
          <div className={`flex items-center gap-3 ${isPlayerTurn && gameStatus === 'playing' ? 'opacity-100' : 'opacity-50'}`}>
            <span className="text-2xl">{playAsBlack ? '⚫' : '⚪'}</span>
            <div>
              <p className="font-bold">{user?.nickname || '玩家'}</p>
              <p className="text-sm text-gray-500">
                提子: {playAsBlack ? capturedByBlack : capturedByWhite}
              </p>
            </div>
            {isPlayerTurn && gameStatus === 'playing' && (
              <span className="px-2 py-1 bg-green-100 text-green-600 text-xs rounded">
                你的回合
              </span>
            )}
          </div>

          <span className="text-gray-400">VS</span>

          {/* AI */}
          <div className={`flex items-center gap-3 ${!isPlayerTurn && gameStatus === 'playing' ? 'opacity-100' : 'opacity-50'}`}>
            {!isPlayerTurn && aiThinking && (
              <span className="px-2 py-1 bg-yellow-100 text-yellow-600 text-xs rounded">
                思考中...
              </span>
            )}
            <div className="text-right">
              <p className="font-bold">AI ({aiLevel === 'easy' ? '初级' : aiLevel === 'medium' ? '中级' : '大模型'})</p>
              <p className="text-sm text-gray-500">
                提子: {playAsBlack ? capturedByWhite : capturedByBlack}
              </p>
            </div>
            <span className="text-2xl">{playAsBlack ? '⚪' : '⚫'}</span>
          </div>
        </div>
      </div>

      {/* 棋盘 */}
      <div className="flex-1 flex items-center justify-center p-4">
        <GoBoard
          size={boardSize}
          board={board}
          onPlaceStone={handlePlaceStone}
          disabled={!isPlayerTurn || aiThinking || gameStatus !== 'playing'}
          currentTurn={currentTurn}
          playerColor={playerColor}
          lastMove={lastMove}
        />
      </div>

      {/* 底部操作栏 */}
      <div className="bg-white shadow-lg px-4 py-4 pb-safe">
        <div className="max-w-4xl mx-auto flex justify-center gap-4">
          <button
            onClick={handlePass}
            disabled={!isPlayerTurn || aiThinking || gameStatus !== 'playing'}
            className="btn-secondary"
          >
            停一手 (PASS)
          </button>
          <button
            onClick={handleResign}
            disabled={gameStatus !== 'playing'}
            className="btn-danger"
          >
            认输
          </button>
        </div>
      </div>

      {/* 断线提示弹窗 */}
      {socketDisconnected && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl p-8 max-w-sm w-full text-center shadow-2xl border border-gray-100">
            <div className="text-5xl mb-4 animate-bounce">📡</div>
            <h2 className="text-2xl font-bold mb-2 text-gray-800">网络连接不稳定</h2>
            <p className="text-gray-600">
              与服务器的连接已断开，正在尝试重新连接，请稍等...
            </p>
            <div className="mt-4 text-red-500 font-bold text-xl">
              剩余重连时间: {disconnectCountdown} 秒
            </div>
            <div className="mt-6 flex justify-center">
              <div className="loading-spinner w-8 h-8 border-4 border-gray-300 border-t-gray-900 rounded-full"></div>
            </div>
          </div>
        </div>
      )}

      {/* 结果弹窗 */}
      {showResult && gameResult && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-8 max-w-sm w-full text-center">
            <div className="text-6xl mb-4">
              {gameResult.winner === playerColor ? '🎉' : '😔'}
            </div>
            <h2 className="text-2xl font-bold mb-2">
              {gameResult.winner === playerColor ? '恭喜获胜！' : '很遗憾，再接再厉！'}
            </h2>
            <p className="text-gray-600 mb-6">{gameResult.description}</p>
            
            <div className="flex gap-3">
              <button
                onClick={handlePlayAgain}
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

export default GamePVE
