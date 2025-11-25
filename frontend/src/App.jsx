import React from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import AuthPage from './pages/AuthPage';
import UserChat from './pages/UserChat';
import AdminDashboard from './pages/AdminDashboard';

function AppContent() {
  const { user, loading } = useAuth();

  if (loading) return <div className="h-screen flex items-center justify-center text-gray-500">Loading...</div>;

  // 1. 未登录 -> 显示登录页
  if (!user) {
    return <AuthPage />;
  }

  // 2. 管理员 -> 显示仪表盘
  // 注意：这里的 role 必须和数据库/AuthPage 中设置的一致
  if (user.role === 'admin') {
    return <AdminDashboard />;
  }

  // 3. 普通用户 -> 显示聊天页
  return <UserChat />;
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}