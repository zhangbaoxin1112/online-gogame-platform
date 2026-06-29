import { useState, useEffect } from 'react'
import { useAuthStore } from '../store/authStore'
import { userAPI } from '../services/api'

// 格式化日期为 YYYY-MM-DD，避免时区问题
const formatDateLocal = (dateStr) => {
  if (!dateStr) return ''
  // 已经是 YYYY-MM-DD 格式，直接返回
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr
  
  // 针对 ISO 字符串，创建 Date 对象并提取本地日期
  // 避免使用substring(0, 10)，因为 2025-07-21T00:00:00Z 在 UTC+8 会被误解为 2025-07-20 (如果直接substring可能没错，但显示会有逻辑问题)
  // 其实最稳妥的方式是解析后取本地年月日
  const date = new Date(dateStr)
  if (isNaN(date.getTime())) return dateStr.substring(0, 10)
  
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const Profile = () => {
  const { user, updateUser } = useAuthStore()
  const [isEditing, setIsEditing] = useState(false)
  const [formData, setFormData] = useState({
    nickname: '',
    region: '',
    birthday: ''
  })
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState({ type: '', text: '' })

  // 密码修改
  const [showPasswordForm, setShowPasswordForm] = useState(false)
  const [passwordData, setPasswordData] = useState({
    oldPassword: '',
    newPassword: '',
    confirmPassword: ''
  })

  useEffect(() => {
    if (user) {
      setFormData({
        nickname: user.nickname || '',
        region: user.region || '',
        birthday: formatDateLocal(user.birthday)
      })
    }
  }, [user])

  const handleChange = (e) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
  }

  const handlePasswordChange = (e) => {
    const { name, value } = e.target
    setPasswordData(prev => ({ ...prev, [name]: value }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setMessage({ type: '', text: '' })
    setLoading(true)

    try {
      const response = await userAPI.updateProfile(formData)
      updateUser(response.data.data.user)
      setMessage({ type: 'success', text: '资料更新成功' })
      setIsEditing(false)
    } catch (error) {
      setMessage({ 
        type: 'error', 
        text: error.response?.data?.message || '更新失败' 
      })
    } finally {
      setLoading(false)
    }
  }

  const handlePasswordSubmit = async (e) => {
    e.preventDefault()
    setMessage({ type: '', text: '' })

    if (passwordData.newPassword !== passwordData.confirmPassword) {
      setMessage({ type: 'error', text: '两次输入的新密码不一致' })
      return
    }

    if (passwordData.newPassword.length < 6) {
      setMessage({ type: 'error', text: '新密码长度至少为6个字符' })
      return
    }

    setLoading(true)
    try {
      await userAPI.changePassword(passwordData.oldPassword, passwordData.newPassword)
      setMessage({ type: 'success', text: '密码修改成功' })
      setShowPasswordForm(false)
      setPasswordData({ oldPassword: '', newPassword: '', confirmPassword: '' })
    } catch (error) {
      setMessage({ 
        type: 'error', 
        text: error.response?.data?.message || '密码修改失败' 
      })
    } finally {
      setLoading(false)
    }
  }

  // 压缩图片（针对移动端大图）
  const compressImage = (file, maxWidth = 800, quality = 0.7) => {
    return new Promise((resolve, reject) => {
      // 如果文件小于300KB，直接返回
      if (file.size < 300 * 1024) {
        resolve(file)
        return
      }

      const reader = new FileReader()
      reader.onerror = () => reject(new Error('读取文件失败'))
      reader.onload = (e) => {
        const img = new Image()
        img.onerror = () => reject(new Error('加载图片失败'))
        img.onload = () => {
          const canvas = document.createElement('canvas')
          let width = img.width
          let height = img.height

          // 按比例缩放，移动端限制更小尺寸
          const targetWidth = Math.min(maxWidth, 600)
          if (width > targetWidth) {
            height = (height * targetWidth) / width
            width = targetWidth
          }

          canvas.width = width
          canvas.height = height
          const ctx = canvas.getContext('2d')
          ctx.drawImage(img, 0, 0, width, height)

          canvas.toBlob((blob) => {
            if (blob) {
              resolve(new File([blob], 'avatar.jpg', { type: 'image/jpeg' }))
            } else {
              reject(new Error('压缩图片失败'))
            }
          }, 'image/jpeg', quality)
        }
        img.src = e.target.result
      }
      reader.readAsDataURL(file)
    })
  }

  const handleAvatarUpload = async (e) => {
    const file = e.target.files[0]
    if (!file) return

    // 检查文件类型 - 只允许常见图片格式
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']
    if (!allowedTypes.includes(file.type.toLowerCase())) {
      setMessage({ type: 'error', text: '请选择 JPG、PNG、GIF 或 WebP 格式的图片' })
      e.target.value = ''
      return
    }

    // 检查文件大小（前端初筛，5MB 以对齐后端限制）
    if (file.size > 5 * 1024 * 1024) {
      setMessage({ type: 'error', text: '图片文件过大（超过5MB），请压缩后再试' })
      e.target.value = ''
      return
    }

    setLoading(true)
    setMessage({ type: 'info', text: '正在处理图片...' })
    
    try {
      // 压缩图片（特别针对移动端拍照的大图）
      const compressedFile = await compressImage(file)
      console.log('压缩后文件大小:', (compressedFile.size / 1024).toFixed(2) + 'KB')
      
      const formData = new FormData()
      formData.append('avatar', compressedFile)

      const response = await userAPI.uploadAvatar(formData)
      updateUser({ avatar: response.data.data.avatar })
      setMessage({ type: 'success', text: '头像上传成功' })
    } catch (error) {
      console.error('头像上传错误:', error)
      setMessage({ 
        type: 'error', 
        text: error.response?.data?.message || '头像上传失败，请重试' 
      })
    } finally {
      setLoading(false)
      // 清空 input 以便重复上传同一文件
      e.target.value = ''
    }
  }

  if (!user) {
    return (
      <div className="flex justify-center py-12">
        <div className="loading-spinner w-8 h-8 border-4 border-gray-300 border-t-gray-900 rounded-full"></div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">个人中心</h1>

      {/* 消息提示 */}
      {message.text && (
        <div className={`px-4 py-3 rounded-lg ${
          message.type === 'success' ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'
        }`}>
          {message.text}
        </div>
      )}

      {/* 用户信息卡片 */}
      <div className="card">
        <div className="flex flex-col sm:flex-row items-center gap-6">
          {/* 头像 */}
          <div className="relative">
            <div className="w-24 h-24 bg-gray-200 rounded-full flex items-center justify-center overflow-hidden">
              {user.avatar ? (
                <img src={user.avatar} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className="text-3xl">{user.nickname?.charAt(0) || '?'}</span>
              )}
            </div>
            <label className="absolute bottom-0 right-0 w-8 h-8 bg-gray-900 rounded-full flex items-center justify-center cursor-pointer hover:bg-gray-700 transition-colors">
              <span className="text-white text-sm">📷</span>
              <input 
                type="file" 
                className="hidden" 
                accept="image/png,image/jpeg,image/jpg"
                onChange={handleAvatarUpload}
                disabled={loading}
              />
            </label>
          </div>

          {/* 基本信息 */}
          <div className="flex-1 text-center sm:text-left">
            <h2 className="text-xl font-bold">{user.nickname}</h2>
            <p className="text-gray-500">@{user.username}</p>
            <div className="flex gap-4 mt-2 justify-center sm:justify-start">
              <span className="text-yellow-600 font-bold">{user.score} 积分</span>
              <span className="text-gray-400">|</span>
              <span className="text-gray-600">{user.total_games || 0} 对局</span>
              <span className="text-gray-400">|</span>
              <span className="text-green-600">{user.win_games || 0} 胜</span>
            </div>
          </div>
        </div>
      </div>

      {/* 编辑资料 */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold">个人资料</h3>
          {!isEditing && (
            <button 
              onClick={() => setIsEditing(true)}
              className="btn-secondary text-sm"
            >
              编辑
            </button>
          )}
        </div>

        {isEditing ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">昵称</label>
              <input
                type="text"
                name="nickname"
                value={formData.nickname}
                onChange={handleChange}
                className="input"
                placeholder="请输入昵称"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">地区</label>
              <input
                type="text"
                name="region"
                value={formData.region}
                onChange={handleChange}
                className="input"
                placeholder="如：北京、上海"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">生日</label>
              <input
                type="date"
                name="birthday"
                value={formData.birthday}
                onChange={handleChange}
                className="input"
              />
            </div>
            <div className="flex gap-3">
              <button type="submit" disabled={loading} className="btn-primary">
                {loading ? '保存中...' : '保存'}
              </button>
              <button 
                type="button" 
                onClick={() => setIsEditing(false)}
                className="btn-secondary"
              >
                取消
              </button>
            </div>
          </form>
        ) : (
          <div className="space-y-3">
            <div className="flex justify-between py-2 border-b">
              <span className="text-gray-500">昵称</span>
              <span>{user.nickname || '-'}</span>
            </div>
            <div className="flex justify-between py-2 border-b">
              <span className="text-gray-500">地区</span>
              <span>{user.region || '-'}</span>
            </div>
            <div className="flex justify-between py-2 border-b">
              <span className="text-gray-500">生日</span>
              <span>{formatDateLocal(user.birthday) || '-'}</span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-gray-500">注册时间</span>
              <span>{formatDateLocal(user.created_at) || '-'}</span>
            </div>
          </div>
        )}
      </div>

      {/* 修改密码 */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold">账号安全</h3>
          {!showPasswordForm && (
            <button 
              onClick={() => setShowPasswordForm(true)}
              className="btn-secondary text-sm"
            >
              修改密码
            </button>
          )}
        </div>

        {showPasswordForm ? (
          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">当前密码</label>
              <input
                type="password"
                name="oldPassword"
                value={passwordData.oldPassword}
                onChange={handlePasswordChange}
                className="input"
                placeholder="请输入当前密码"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">新密码</label>
              <input
                type="password"
                name="newPassword"
                value={passwordData.newPassword}
                onChange={handlePasswordChange}
                className="input"
                placeholder="至少6个字符"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">确认新密码</label>
              <input
                type="password"
                name="confirmPassword"
                value={passwordData.confirmPassword}
                onChange={handlePasswordChange}
                className="input"
                placeholder="再次输入新密码"
              />
            </div>
            <div className="flex gap-3">
              <button type="submit" disabled={loading} className="btn-primary">
                {loading ? '修改中...' : '修改密码'}
              </button>
              <button 
                type="button" 
                onClick={() => {
                  setShowPasswordForm(false)
                  setPasswordData({ oldPassword: '', newPassword: '', confirmPassword: '' })
                }}
                className="btn-secondary"
              >
                取消
              </button>
            </div>
          </form>
        ) : (
          <p className="text-gray-500 text-sm">定期修改密码可以提高账号安全性</p>
        )}
      </div>
    </div>
  )
}

export default Profile
