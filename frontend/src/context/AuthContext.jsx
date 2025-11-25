import React, { createContext, useState, useContext, useEffect } from 'react';
import axios from 'axios';

const AuthContext = createContext(null);

// 全局配置 axios 允许携带 cookie
axios.defaults.withCredentials = true;

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // 1. 初始化检查：询问服务器 "我登录了吗？"
  useEffect(() => {
    checkLoginStatus();
  }, []);

  const checkLoginStatus = async () => {
    try {
      const res = await axios.get('http://localhost:3001/api/auth/me');
      setUser(res.data); // { email: '...', role: '...' }
    } catch (e) {
      setUser(null); // 未登录或 cookie 过期
    } finally {
      setLoading(false);
    }
  };

  const login = (role, email) => {
    setUser({ role, email });
  };

  const logout = async () => {
    try {
      await axios.post('http://localhost:3001/api/auth/logout');
      setUser(null);
    } catch (e) {
      console.error("退出失败", e);
    }
  };

  // ✨ 核心机制：拦截器
  // 自动监听所有请求，如果后端返回 401/403 (Cookie过期)，自动踢出
  useEffect(() => {
    const interceptor = axios.interceptors.response.use(
      response => response,
      error => {
        if (error.response && (error.response.status === 401 || error.response.status === 403)) {
          // 如果不是在登录页，且收到 401，说明 cookie 过期了
          if (window.location.pathname !== '/') {
             setUser(null); // 触发 UI 切换回登录页
          }
        }
        return Promise.reject(error);
      }
    );
    return () => axios.interceptors.response.eject(interceptor);
  }, []);

  return (
    <AuthContext.Provider value={{ user, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);