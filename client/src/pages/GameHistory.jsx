import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { userAPI } from '../services/api'

const GameHistory = () => {
  const [games, setGames] = useState([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [pagination, setPagination] = useState(null)

  useEffect(() => {
    fetchHistory()
  }, [page])

  const fetchHistory = async () => {
    setLoading(true)
    try {
      const response = await userAPI.getGameHistory(page, 10)
      setGames(response.data.data.games)
      setPagination(response.data.data.pagination)
    } catch (error) {
      console.error('获取对局历史失败:', error)
    } finally {
      setLoading(false)
    }
  }

  const formatDate = (dateString) => {
    const date = new Date(dateString)
    return date.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const formatDuration = (seconds) => {
    if (!seconds) return '-'
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}分${secs}秒`
  }

  const getGameTypeLabel = (type, aiLevel) => {
    if (type === 'pve') {
      const levelLabels = { easy: '初级', medium: '中级', hard: '高级' }
      return `人机对战 (${levelLabels[aiLevel] || aiLevel})`
    }
    return '网络对战'
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">📋 对局记录</h1>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="loading-spinner w-8 h-8 border-4 border-gray-300 border-t-gray-900 rounded-full"></div>
        </div>
      ) : games.length > 0 ? (
        <>
          <div className="space-y-4">
            {games.map((game) => (
              <div key={game.id} className="card hover:shadow-lg transition-shadow">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  {/* 对局信息 */}
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${
                        game.game_type === 'pvp' 
                          ? 'bg-green-100 text-green-700' 
                          : 'bg-blue-100 text-blue-700'
                      }`}>
                        {getGameTypeLabel(game.game_type, game.ai_level)}
                      </span>
                      <span className="text-xs text-gray-400">
                        {game.board_size}×{game.board_size}
                      </span>
                    </div>

                    <div className="flex items-center gap-4">
                      {/* 黑方 */}
                      <div className="flex items-center gap-2">
                        <span className="text-lg">⚫</span>
                        <span className="font-medium">
                          {game.black_player_name || 'AI'}
                        </span>
                      </div>

                      <span className="text-gray-400">vs</span>

                      {/* 白方 */}
                      <div className="flex items-center gap-2">
                        <span className="text-lg">⚪</span>
                        <span className="font-medium">
                          {game.white_player_name || 'AI'}
                        </span>
                      </div>
                    </div>

                    <p className="text-sm text-gray-500 mt-2">
                      {game.result || '游戏进行中'}
                    </p>
                  </div>

                  {/* 结果和时间 */}
                  <div className="text-right">
                    {game.winner_name && (
                      <p className="font-medium text-green-600 mb-1">
                        🏆 {game.winner_name} 获胜
                      </p>
                    )}
                    <p className="text-sm text-gray-400">
                      {formatDate(game.created_at)}
                    </p>
                    <p className="text-sm text-gray-400">
                      用时: {formatDuration(game.duration)}
                    </p>
                  </div>
                </div>

                {/* 查看回放按钮 */}
                {game.moves_record && game.moves_record.length > 0 && (
                  <div className="mt-4 pt-4 border-t">
                    <Link 
                      to={`/game/replay/${game.id}`}
                      className="text-sm text-blue-600 hover:underline"
                    >
                      查看棋谱回放 →
                    </Link>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* 分页 */}
          {pagination && pagination.totalPages > 1 && (
            <div className="flex justify-center gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="btn-secondary"
              >
                上一页
              </button>
              <span className="px-4 py-2 text-gray-600">
                {page} / {pagination.totalPages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(pagination.totalPages, p + 1))}
                disabled={page === pagination.totalPages}
                className="btn-secondary"
              >
                下一页
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="card text-center py-12">
          <span className="text-4xl mb-4 block">🎮</span>
          <p className="text-gray-500">暂无对局记录</p>
          <p className="text-sm text-gray-400 mt-2">开始您的第一局围棋吧！</p>
          <Link to="/" className="btn-primary mt-4 inline-block">
            开始对弈
          </Link>
        </div>
      )}
    </div>
  )
}

export default GameHistory
