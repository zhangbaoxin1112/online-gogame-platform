import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { gameAPI } from '../services/api'
import GoBoard from '../components/GoBoard'

const GameReplay = () => {
  const { id } = useParams()
  const navigate = useNavigate()
  const [game, setGame] = useState(null)
  const [loading, setLoading] = useState(true)
  const [currentMoveIndex, setCurrentMoveIndex] = useState(-1)
  const [board, setBoard] = useState(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [playSpeed, setPlaySpeed] = useState(1000) // 毫秒

  useEffect(() => {
    fetchGame()
  }, [id])

  useEffect(() => {
    let timer
    if (isPlaying && game && currentMoveIndex < game.moves_record.length - 1) {
      timer = setTimeout(() => {
        goToMove(currentMoveIndex + 1)
      }, playSpeed)
    } else if (isPlaying && currentMoveIndex >= game?.moves_record?.length - 1) {
      setIsPlaying(false)
    }
    return () => clearTimeout(timer)
  }, [isPlaying, currentMoveIndex, game, playSpeed])

  const fetchGame = async () => {
    try {
      const response = await gameAPI.getGame(id)
      const gameData = response.data.data.game
      
      // 解析棋谱
      if (typeof gameData.moves_record === 'string') {
        gameData.moves_record = JSON.parse(gameData.moves_record)
      }
      
      setGame(gameData)
      
      // 初始化空棋盘
      const size = gameData.board_size || 19
      setBoard(createEmptyBoard(size))
      
    } catch (error) {
      console.error('获取对局详情失败:', error)
    } finally {
      setLoading(false)
    }
  }

  const createEmptyBoard = (size) => {
    return Array(size).fill(null).map(() => Array(size).fill(null))
  }

  // 跳转到指定手
  const goToMove = (index) => {
    if (!game) return

    const size = game.board_size || 19
    const newBoard = createEmptyBoard(size)
    
    // 重新播放到指定位置
    for (let i = 0; i <= index; i++) {
      const move = game.moves_record[i]
      if (!move.pass) {
        newBoard[move.y][move.x] = move.color
        
        // 处理提子
        if (move.captured && move.captured.length > 0) {
          for (const pos of move.captured) {
            newBoard[pos.y][pos.x] = null
          }
        }
      }
    }
    
    setBoard(newBoard)
    setCurrentMoveIndex(index)
  }

  // 控制函数
  const goToStart = () => {
    setBoard(createEmptyBoard(game.board_size || 19))
    setCurrentMoveIndex(-1)
    setIsPlaying(false)
  }

  const goToEnd = () => {
    goToMove(game.moves_record.length - 1)
    setIsPlaying(false)
  }

  const goPrev = () => {
    if (currentMoveIndex >= 0) {
      goToMove(currentMoveIndex - 1)
    }
    setIsPlaying(false)
  }

  const goNext = () => {
    if (currentMoveIndex < game.moves_record.length - 1) {
      goToMove(currentMoveIndex + 1)
    }
  }

  const togglePlay = () => {
    if (currentMoveIndex >= game.moves_record.length - 1) {
      // 如果已经到末尾，从头开始
      goToStart()
      setTimeout(() => setIsPlaying(true), 100)
    } else {
      setIsPlaying(!isPlaying)
    }
  }

  // 获取当前手信息
  const getCurrentMove = () => {
    if (currentMoveIndex < 0 || !game?.moves_record) return null
    return game.moves_record[currentMoveIndex]
  }

  const currentMove = getCurrentMove()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="loading-spinner w-8 h-8 border-4 border-gray-300 border-t-gray-900 rounded-full"></div>
      </div>
    )
  }

  if (!game) {
    return (
      <div className="max-w-4xl mx-auto py-12 text-center">
        <p className="text-gray-500">对局不存在或加载失败</p>
        <button onClick={() => navigate(-1)} className="btn-secondary mt-4">
          返回
        </button>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto pb-6 space-y-4 md:space-y-6">
      {/* 头部信息 */}
      <div className="flex items-center justify-between sticky top-0 bg-gray-50 py-2 z-10">
        <button onClick={() => navigate(-1)} className="text-gray-500 hover:text-gray-700">
          ← 返回
        </button>
        <h1 className="text-lg md:text-xl font-bold">棋谱回放</h1>
        <div className="w-12"></div>
      </div>

      {/* 对局信息 - 移动端简化 */}
      <div className="card p-3 md:p-6">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-2 md:gap-4">
          <div className="flex items-center gap-2 md:gap-4 text-sm md:text-base">
            {/* 黑方 */}
            <div className="flex items-center gap-1 md:gap-2">
              <span className="text-lg md:text-2xl">⚫</span>
              <div>
                <p className="font-bold text-xs md:text-base">{game.black_player_name || 'AI'}</p>
              </div>
            </div>

            <span className="text-gray-400">vs</span>

            {/* 白方 */}
            <div className="flex items-center gap-1 md:gap-2">
              <div className="text-right">
                <p className="font-bold text-xs md:text-base">{game.white_player_name || 'AI'}</p>
              </div>
              <span className="text-lg md:text-2xl">⚪</span>
            </div>
          </div>

          <div className="text-center sm:text-right text-xs md:text-base">
            <p className="text-green-600 font-medium">{game.result || '进行中'}</p>
            <p className="text-gray-400">共 {game.moves_record?.length || 0} 手</p>
          </div>
        </div>
      </div>

      {/* 棋盘 */}
      <div className="flex justify-center">
        <GoBoard
          size={game.board_size || 19}
          board={board}
          disabled={true}
          lastMove={currentMove}
          showCoordinates={true}
        />
      </div>

      {/* 当前手信息 */}
      {/* 当前手数信息 */}
      <div className="text-center text-xs md:text-sm text-gray-500 py-1">
        {currentMoveIndex < 0 ? (
          '起始位置'
        ) : currentMove?.pass ? (
          `第 ${currentMoveIndex + 1} 手: ${currentMove.color === 'black' ? '黑方' : '白方'} PASS`
        ) : (
          `第 ${currentMoveIndex + 1} 手: ${currentMove?.color === 'black' ? '黑方' : '白方'} (${String.fromCharCode(65 + currentMove?.x)}, ${game.board_size - currentMove?.y})`
        )}
      </div>

      {/* 播放控制 - 移动端紧凑布局 */}
      <div className="card p-3 md:p-6">
        {/* 进度条 */}
        <div className="mb-3 md:mb-4">
          <input
            type="range"
            min="-1"
            max={(game.moves_record?.length || 1) - 1}
            value={currentMoveIndex}
            onChange={(e) => goToMove(parseInt(e.target.value))}
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
          />
          <div className="flex justify-between text-xs text-gray-400 mt-1">
            <span>开始</span>
            <span>{currentMoveIndex + 1} / {game.moves_record?.length || 0}</span>
            <span>结束</span>
          </div>
        </div>

        {/* 控制按钮 - 移动端更紧凑 */}
        <div className="flex items-center justify-center gap-1 md:gap-2">
          <button onClick={goToStart} className="btn-secondary px-2 md:px-3 py-1 md:py-2 text-sm md:text-base">
            ⏮️
          </button>
          <button onClick={goPrev} className="btn-secondary px-2 md:px-3 py-1 md:py-2 text-sm md:text-base">
            ⏪
          </button>
          <button 
            onClick={togglePlay}
            className="btn-primary px-3 md:px-6 py-1 md:py-2 text-sm md:text-base"
          >
            {isPlaying ? '⏸️' : '▶️'}<span className="hidden sm:inline"> {isPlaying ? '暂停' : '播放'}</span>
          </button>
          <button onClick={goNext} className="btn-secondary px-2 md:px-3 py-1 md:py-2 text-sm md:text-base">
            ⏩
          </button>
          <button onClick={goToEnd} className="btn-secondary px-2 md:px-3 py-1 md:py-2 text-sm md:text-base">
            ⏭️
          </button>
        </div>

        {/* 播放速度 - 移动端更紧凑 */}
        <div className="flex items-center justify-center gap-1 md:gap-2 mt-3 md:mt-4">
          <span className="text-xs md:text-sm text-gray-500">速度:</span>
          {[2000, 1000, 500, 200].map(speed => (
            <button
              key={speed}
              onClick={() => setPlaySpeed(speed)}
              className={`px-1.5 md:px-2 py-0.5 md:py-1 text-xs md:text-sm rounded ${
                playSpeed === speed 
                  ? 'bg-gray-900 text-white' 
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {speed === 2000 ? '0.5x' : speed === 1000 ? '1x' : speed === 500 ? '2x' : '5x'}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export default GameReplay
