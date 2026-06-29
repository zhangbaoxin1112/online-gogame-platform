import { useState, useEffect } from 'react'
import { rankAPI } from '../services/api'
import { useAuthStore } from '../store/authStore'

const Leaderboard = () => {
  const { user, isAuthenticated } = useAuthStore()
  const [leaderboard, setLeaderboard] = useState([])
  const [dailyRank, setDailyRank] = useState([])
  const [userRank, setUserRank] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('total') // 'total' or 'daily'
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)

  useEffect(() => {
    fetchData()
  }, [page])

  useEffect(() => {
    if (isAuthenticated && user) {
      fetchUserRank()
    }
  }, [isAuthenticated, user])

  const fetchData = async () => {
    setLoading(true)
    try {
      const [leaderboardRes, dailyRes] = await Promise.all([
        rankAPI.getLeaderboard(page, 20),
        rankAPI.getDailyRank(20)
      ])
      
      setLeaderboard(leaderboardRes.data.data.users)
      setTotalPages(leaderboardRes.data.data.pagination.totalPages)
      setDailyRank(dailyRes.data.data.users)
    } catch (error) {
      console.error('获取排行榜失败:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchUserRank = async () => {
    try {
      const response = await rankAPI.getUserRank(user.id)
      setUserRank(response.data.data)
    } catch (error) {
      console.error('获取用户排名失败:', error)
    }
  }

  const getRankIcon = (rank) => {
    switch (rank) {
      case 1: return '🥇'
      case 2: return '🥈'
      case 3: return '🥉'
      default: return null
    }
  }

  const getRankColor = (rank) => {
    switch (rank) {
      case 1: return 'bg-yellow-100 text-yellow-700'
      case 2: return 'bg-gray-100 text-gray-600'
      case 3: return 'bg-orange-100 text-orange-700'
      default: return 'bg-gray-50 text-gray-500'
    }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">🏆 排行榜</h1>

      {/* 我的排名 */}
      {isAuthenticated && userRank && (
        <div className="card bg-gradient-to-r from-gray-900 to-gray-700 text-white">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center">
                {user?.avatar ? (
                  <img src={user.avatar} alt="" className="w-full h-full object-cover rounded-full" />
                ) : (
                  <span className="text-2xl">{user?.nickname?.charAt(0) || '?'}</span>
                )}
              </div>
              <div>
                <p className="font-bold text-lg">{user?.nickname}</p>
                <p className="text-gray-300">我的排名</p>
              </div>
            </div>
            <div className="flex gap-8 text-center">
              <div>
                <p className="text-3xl font-bold text-yellow-400">#{userRank.rank}</p>
                <p className="text-sm text-gray-300">排名</p>
              </div>
              <div>
                <p className="text-3xl font-bold">{userRank.score}</p>
                <p className="text-sm text-gray-300">积分</p>
              </div>
              <div>
                <p className="text-3xl font-bold text-green-400">{userRank.win_rate}%</p>
                <p className="text-sm text-gray-300">胜率</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 标签切换 */}
      <div className="flex gap-2">
        <button
          onClick={() => setActiveTab('total')}
          className={`px-4 py-2 rounded-lg font-medium transition-colors ${
            activeTab === 'total' 
              ? 'bg-gray-900 text-white' 
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          总排行
        </button>
        <button
          onClick={() => setActiveTab('daily')}
          className={`px-4 py-2 rounded-lg font-medium transition-colors ${
            activeTab === 'daily' 
              ? 'bg-gray-900 text-white' 
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          今日榜
        </button>
      </div>

      {/* 排行榜列表 */}
      <div className="card">
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="loading-spinner w-8 h-8 border-4 border-gray-300 border-t-gray-900 rounded-full"></div>
          </div>
        ) : (
          <>
            {activeTab === 'total' ? (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="text-left text-gray-500 text-sm border-b">
                        <th className="pb-3 w-16">排名</th>
                        <th className="pb-3">玩家</th>
                        <th className="pb-3 text-right">积分</th>
                        <th className="pb-3 text-right hidden sm:table-cell">对局</th>
                        <th className="pb-3 text-right hidden sm:table-cell">胜率</th>
                      </tr>
                    </thead>
                    <tbody>
                      {leaderboard.map((player, index) => {
                        const rank = (page - 1) * 20 + index + 1
                        const isCurrentUser = isAuthenticated && player.id === user?.id
                        
                        return (
                          <tr 
                            key={player.id} 
                            className={`border-b last:border-0 ${isCurrentUser ? 'bg-blue-50' : ''}`}
                          >
                            <td className="py-4">
                              {getRankIcon(rank) || (
                                <span className={`w-8 h-8 flex items-center justify-center rounded-full text-sm font-bold ${getRankColor(rank)}`}>
                                  {rank}
                                </span>
                              )}
                            </td>
                            <td className="py-4">
                              <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center overflow-hidden">
                                  {player.avatar ? (
                                    <img src={player.avatar} alt="" className="w-full h-full object-cover" />
                                  ) : (
                                    <span className="text-sm">{player.nickname?.charAt(0) || '?'}</span>
                                  )}
                                </div>
                                <div>
                                  <p className="font-medium">
                                    {player.nickname}
                                    {isCurrentUser && (
                                      <span className="ml-2 text-xs text-blue-500">(你)</span>
                                    )}
                                  </p>
                                  <p className="text-xs text-gray-400">@{player.username}</p>
                                </div>
                              </div>
                            </td>
                            <td className="py-4 text-right">
                              <span className="font-bold text-yellow-600">{player.score}</span>
                            </td>
                            <td className="py-4 text-right hidden sm:table-cell text-gray-600">
                              {player.total_games}
                            </td>
                            <td className="py-4 text-right hidden sm:table-cell">
                              <span className={`font-medium ${
                                player.win_rate >= 50 ? 'text-green-600' : 'text-gray-600'
                              }`}>
                                {player.win_rate}%
                              </span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                {/* 分页 */}
                {totalPages > 1 && (
                  <div className="flex justify-center gap-2 mt-6">
                    <button
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                      disabled={page === 1}
                      className="btn-secondary"
                    >
                      上一页
                    </button>
                    <span className="px-4 py-2 text-gray-600">
                      {page} / {totalPages}
                    </span>
                    <button
                      onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                      disabled={page === totalPages}
                      className="btn-secondary"
                    >
                      下一页
                    </button>
                  </div>
                )}
              </>
            ) : (
              <>
                <p className="text-sm text-gray-500 mb-4">今日积分增长榜</p>
                {dailyRank.length > 0 ? (
                  <div className="space-y-3">
                    {dailyRank.map((player, index) => (
                      <div 
                        key={player.id}
                        className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                      >
                        <div className="flex items-center gap-3">
                          {getRankIcon(index + 1) || (
                            <span className="w-6 h-6 flex items-center justify-center rounded-full bg-gray-200 text-gray-600 text-sm font-bold">
                              {index + 1}
                            </span>
                          )}
                          <div className="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center overflow-hidden">
                            {player.avatar ? (
                              <img src={player.avatar} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <span className="text-xs">{player.nickname?.charAt(0) || '?'}</span>
                            )}
                          </div>
                          <span className="font-medium">{player.nickname}</span>
                        </div>
                        <div className="text-right">
                          <p className="text-green-600 font-bold">+{player.daily_score_change}</p>
                          <p className="text-xs text-gray-400">当前: {player.score}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-center text-gray-400 py-8">今日暂无数据</p>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default Leaderboard
