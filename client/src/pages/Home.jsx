import { useNavigate, Link } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { useState, useEffect } from 'react'
import { rankAPI, gameAPI } from '../services/api'
import socketService from '../services/socket'

const Home = () => {
  const { isAuthenticated, user, token } = useAuthStore()
  const [stats, setStats] = useState(null)
  const [topPlayers, setTopPlayers] = useState([])
  const [activeGameInfo, setActiveGameInfo] = useState(null)
  const [showRecoveryModal, setShowRecoveryModal] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    // 获取统计数据
    const fetchData = async () => {
      try {
        const [statsRes, rankRes] = await Promise.all([
          rankAPI.getStats(),
          rankAPI.getLeaderboard(1, 5)
        ])
        setStats(statsRes.data.data)
        setTopPlayers(rankRes.data.data.users)
      } catch (error) {
        console.error('获取数据失败:', error)
      }
    }
    fetchData()
  }, [])

  // 检查是否有活跃中的对局
  useEffect(() => {
    if (!isAuthenticated || !token) return

    // 1. 检查 PVE 活跃对局 (localStorage)
    const checkPVE = () => {
      const savedPVE = localStorage.getItem('pve_game_state')
      if (savedPVE) {
        try {
          const state = JSON.parse(savedPVE)
          const now = Date.now()
          const isTimedOut = now - (state.lastUpdateTime || 0) >= 30000

          if (isTimedOut) {
            // 已超时，后台静默结算为认输
            console.log('检测到 PVE 对局已超时，执行静默结算...')
            const duration = state.startTime ? Math.floor((now - state.startTime) / 1000) : 0
            gameAPI.finishPVE(state.gameId, null, state.moves || [], '断连超时(自动认输)', duration)
              .catch(err => console.error('PVE 静默结算失败:', err))
            localStorage.removeItem('pve_game_state')
            return false
          }

          // 未超时，提示恢复
          setActiveGameInfo({
            type: 'PVE',
            mode: '人机对弈',
            opponent: `AI (等级:${state.aiLevel})`,
            gameId: state.gameId,
            moves: state.moves || [],
            startTime: state.startTime,
            lastUpdateTime: state.lastUpdateTime
          })
          setShowRecoveryModal(true)
          return true
        } catch (e) {
          localStorage.removeItem('pve_game_state')
        }
      }
      return false
    }

    // 2. 检查 PVP 活跃对局 (Socket)
    const checkPVP = () => {
      const socket = socketService.connect(token)

      const handleActiveGame = (data) => {
        console.log('检测到活跃 PVP 对局:', data)
        setActiveGameInfo({
          type: 'PVP',
          mode: '网络对战',
          opponent: data.opponentName,
          roomId: data.roomId,
          gameId: data.gameId,
          // 补全传参，防止 PVP 页面初始化时因缺失玩家信息崩溃
          boardSize: data.boardSize,
          blackPlayer: data.blackPlayer,
          whitePlayer: data.whitePlayer
        })
        setShowRecoveryModal(true)
      }

      const requestCheck = () => {
        console.log('Socket 已连通，请求检查活跃对局...')
        socketService.emit('check_active_game')
      }

      socketService.on('active_game_found', handleActiveGame)
      
      // 如果已连接，直接发送；否则等待连通事件
      if (socketService.isConnected()) {
        requestCheck()
      } else {
        socketService.on('connect', requestCheck)
      }

      return () => {
        socketService.off('active_game_found', handleActiveGame)
        socketService.off('connect', requestCheck)
      }
    }

    if (!checkPVE()) {
      return checkPVP()
    }
  }, [isAuthenticated, token])

  const handleResumeGame = () => {
    if (activeGameInfo.type === 'PVE') {
      navigate('/game/pve')
    } else {
      navigate('/game/pvp', {
        state: {
          roomId: activeGameInfo.roomId,
          gameId: activeGameInfo.gameId,
          boardSize: activeGameInfo.boardSize,
          blackPlayer: activeGameInfo.blackPlayer,
          whitePlayer: activeGameInfo.whitePlayer,
          reconnect: true
        }
      })
    }
    setShowRecoveryModal(false)
  }

  const handleAbandonGame = async () => {
    if (activeGameInfo.type === 'PVE') {
      try {
        // 计算对局时长
        const duration = activeGameInfo.startTime 
          ? Math.floor((Date.now() - activeGameInfo.startTime) / 1000) 
          : 0

        // PVE 认输结算 (携带现有棋谱和时长，确保可回放)
        await gameAPI.finishPVE(
          activeGameInfo.gameId, 
          null, 
          activeGameInfo.moves || [], 
          '玩家在恢复提示中选择离开(自动认输)', 
          duration
        )
        localStorage.removeItem('pve_game_state')
      } catch (err) {
        console.error('PVE 认输失败:', err)
        localStorage.removeItem('pve_game_state')
      }
    } else {
      // PVP 认输处理
      if (activeGameInfo.roomId) {
        socketService.resign(activeGameInfo.roomId)
      }
    }
    setShowRecoveryModal(false)
    setActiveGameInfo(null)
  }

  return (
    <div className="space-y-8">
      {/* Hero Section */}
      <section className="bg-gradient-to-br from-gray-900 to-gray-700 rounded-2xl p-8 md:p-12 text-white text-center">
        <h1 className="text-3xl md:text-5xl font-bold mb-4">
          网络围棋 <span className="text-yellow-400">⚫⚪</span>
        </h1>
        <p className="text-gray-300 text-lg md:text-xl mb-8 max-w-2xl mx-auto">
          在线围棋对战平台，支持人机对弈和网络对战
          <br />
          随时随地，PC端/移动端畅玩
        </p>

        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          {isAuthenticated ? (
            <>
              <Link to="/game/pve" className="btn-primary text-lg px-8 py-3">
                🤖 人机对弈
              </Link>
              <Link to="/matching" className="btn-success text-lg px-8 py-3">
                🌐 网络对战
              </Link>
            </>
          ) : (
            <>
              <Link to="/register" className="btn-primary text-lg px-8 py-3">
                立即注册
              </Link>
              <Link to="/login" className="btn-secondary text-lg px-8 py-3">
                登录
              </Link>
            </>
          )}
        </div>
      </section>

      {/* 围棋规则简介（放在显眼位置） */}
      <section className="card bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200">
        <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
          <span>📖</span> 围棋规则简介
        </h3>
        <div className="grid md:grid-cols-3 gap-6 text-sm text-gray-700">
          <div className="bg-white/60 rounded-lg p-4">
            <h4 className="font-bold text-gray-900 mb-2">⚫ 基本规则</h4>
            <p>黑白双方轮流落子，黑先白后。棋子落定后不能移动，但可能被提掉。</p>
          </div>
          <div className="bg-white/60 rounded-lg p-4">
            <h4 className="font-bold text-gray-900 mb-2">💨 气与提子</h4>
            <p>棋子相邻的空交叉点叫"气"。当棋子或棋子群的气被全部堵住时，该棋子被提掉。</p>
          </div>
          <div className="bg-white/60 rounded-lg p-4">
            <h4 className="font-bold text-gray-900 mb-2">🏆 胜负判定</h4>
            <p>双方都不再落子时（连续PASS），数子定胜负。围住的地盘多者获胜。</p>
          </div>
        </div>
      </section>

      {/* 快捷入口（已登录时显示） */}
      {isAuthenticated && (
        <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Link to="/game/pve" className="card hover:shadow-lg text-center py-6 transition-shadow">
            <span className="text-3xl mb-2 block">🤖</span>
            <p className="font-semibold">人机对弈</p>
          </Link>
          <Link to="/matching" className="card hover:shadow-lg text-center py-6 transition-shadow">
            <span className="text-3xl mb-2 block">🌐</span>
            <p className="font-semibold">网络对战</p>
          </Link>
          <Link to="/friends" className="card hover:shadow-lg text-center py-6 transition-shadow">
            <span className="text-3xl mb-2 block">👥</span>
            <p className="font-semibold">好友系统</p>
          </Link>
          <Link to="/history" className="card hover:shadow-lg text-center py-6 transition-shadow">
            <span className="text-3xl mb-2 block">📜</span>
            <p className="font-semibold">对局历史</p>
          </Link>
        </section>
      )}

      {/* 游戏模式 */}
      <section className="grid md:grid-cols-2 gap-6">
        <div className="card hover:shadow-lg transition-shadow">
          <div className="flex items-center space-x-4 mb-4">
            <span className="text-4xl">🤖</span>
            <h3 className="text-xl font-bold">人机对弈</h3>
          </div>
          <p className="text-gray-600 mb-4">
            与AI进行围棋对战，支持初级、中级、大模型三个难度等级。
            适合练习和提升棋力。
          </p>
          <ul className="text-sm text-gray-500 mb-4 space-y-1">
            <li>✅ 三种难度可选</li>
            <li>✅ 19*19路棋盘</li>
            <li>✅ 单机即可游玩</li>
          </ul>
          <Link
            to={isAuthenticated ? "/game/pve" : "/login"}
            className="btn-primary w-full text-center block"
          >
            开始人机对弈
          </Link>
        </div>

        <div className="card hover:shadow-lg transition-shadow">
          <div className="flex items-center space-x-4 mb-4">
            <span className="text-4xl">🌐</span>
            <h3 className="text-xl font-bold">网络对战</h3>
          </div>
          <p className="text-gray-600 mb-4">
            与其他玩家实时在线对战，积分排名，展现真正实力。
            支持匹配对手和好友对战。
          </p>
          <ul className="text-sm text-gray-500 mb-4 space-y-1">
            <li>✅ 实时在线对战</li>
            <li>✅ 积分排名系统</li>
            <li>✅ 断线重连支持</li>
          </ul>
          <Link
            to={isAuthenticated ? "/matching" : "/login"}
            className="btn-success w-full text-center block"
          >
            开始网络对战
          </Link>
        </div>
      </section>

      {/* 统计和排行 */}
      <section className="grid md:grid-cols-2 gap-6">
        {/* 平台统计 */}
        <div className="card">
          <h3 className="text-lg font-bold mb-4">📊 平台统计</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="text-center p-4 bg-gray-50 rounded-lg">
              <p className="text-3xl font-bold text-gray-800">{stats?.totalUsers || 0}</p>
              <p className="text-sm text-gray-500">注册用户</p>
            </div>
            <div className="text-center p-4 bg-gray-50 rounded-lg">
              <p className="text-3xl font-bold text-green-600">{stats?.activeUsersToday || 0}</p>
              <p className="text-sm text-gray-500">今日活跃</p>
            </div>
            <div className="text-center p-4 bg-gray-50 rounded-lg">
              <p className="text-3xl font-bold text-blue-600">{stats?.totalGames || 0}</p>
              <p className="text-sm text-gray-500">总对局数</p>
            </div>
            <div className="text-center p-4 bg-gray-50 rounded-lg">
              <p className="text-3xl font-bold text-yellow-600">{stats?.todayGames || 0}</p>
              <p className="text-sm text-gray-500">今日对局</p>
            </div>
          </div>
        </div>

        {/* 排行榜预览 */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold">🏆 积分排行</h3>
            <Link to="/leaderboard" className="text-sm text-blue-600 hover:underline">
              查看全部 →
            </Link>
          </div>
          <div className="space-y-3">
            {topPlayers.map((player, index) => (
              <div key={player.id} className="flex items-center justify-between p-2 hover:bg-gray-50 rounded">
                <div className="flex items-center space-x-3">
                  <span className={`w-6 h-6 flex items-center justify-center rounded-full text-sm font-bold
                    ${index === 0 ? 'bg-yellow-400 text-white' :
                      index === 1 ? 'bg-gray-400 text-white' :
                        index === 2 ? 'bg-orange-400 text-white' : 'bg-gray-200 text-gray-600'}`}>
                    {index + 1}
                  </span>
                  <span className="font-medium">{player.nickname}</span>
                </div>
                <span className="text-yellow-600 font-bold">{player.score}</span>
              </div>
            ))}
            {topPlayers.length === 0 && (
              <p className="text-center text-gray-400 py-4">暂无数据</p>
            )}
          </div>
        </div>
      </section>

      {/* 对局恢复确认弹窗 */}
      {showRecoveryModal && activeGameInfo && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full text-center transform transition-all scale-100 animate-in fade-in zoom-in duration-300">
            <div className="text-5xl mb-4">♟️</div>
            <h3 className="text-xl font-bold mb-2">检测到进行中的对局</h3>
            <p className="text-gray-600 mb-6">
              您有一个未结束的 <span className="text-blue-600 font-bold">{activeGameInfo.mode}</span>。
              <br />
              对手: <span className="font-semibold">{activeGameInfo.opponent}</span>
              <br />
              是否立即返回对局？
            </p>
            <div className="flex gap-3">
              <button
                onClick={handleResumeGame}
                className="btn-primary flex-1 py-3 font-bold"
              >
                立即恢复
              </button>
              <button
                onClick={handleAbandonGame}
                className="btn-secondary flex-1 py-3"
              >
                离开
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-4">
              提示：若不复通，{activeGameInfo.type === 'PVP' ? '30秒后将判定为认输' : '对局状态将被清理'}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

export default Home
