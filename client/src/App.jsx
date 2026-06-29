import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './store/authStore'

// 页面组件
import Home from './pages/Home'
import Login from './pages/Login'
import Register from './pages/Register'
import Profile from './pages/Profile'
import GamePVE from './pages/GamePVE'
import GamePVP from './pages/GamePVP'
import Matching from './pages/Matching'
import Leaderboard from './pages/Leaderboard'
import GameHistory from './pages/GameHistory'
import GameReplay from './pages/GameReplay'
import Friends from './pages/Friends'

// 布局组件
import Layout from './components/Layout'
import SocketManager from './components/SocketManager'

// 受保护路由组件
const ProtectedRoute = ({ children }) => {
  const { isAuthenticated, isLoading } = useAuthStore()
  
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="loading-spinner w-8 h-8 border-4 border-gray-300 border-t-gray-900 rounded-full"></div>
      </div>
    )
  }
  
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }
  
  return children
}

function App() {
  return (
    <Router>
      {/* Socket连接管理器 */}
      <SocketManager />
      
      <Routes>
        {/* 公开路由 */}
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        
        {/* 带布局的路由 */}
        <Route path="/" element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="leaderboard" element={<Leaderboard />} />
          <Route path="game/replay/:id" element={<GameReplay />} />
          
          {/* 受保护路由 */}
          <Route path="profile" element={
            <ProtectedRoute><Profile /></ProtectedRoute>
          } />
          <Route path="history" element={
            <ProtectedRoute><GameHistory /></ProtectedRoute>
          } />
          <Route path="friends" element={
            <ProtectedRoute><Friends /></ProtectedRoute>
          } />
        </Route>
        
        {/* 游戏页面（全屏，不带导航） */}
        <Route path="/game/pve" element={
          <ProtectedRoute><GamePVE /></ProtectedRoute>
        } />
        <Route path="/game/pvp" element={
          <ProtectedRoute><GamePVP /></ProtectedRoute>
        } />
        <Route path="/matching" element={
          <ProtectedRoute><Matching /></ProtectedRoute>
        } />
        
        {/* 404 */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  )
}

export default App
