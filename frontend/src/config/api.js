import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_APP_BASE_API || '/api',
  withCredentials: true,
})

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)

export default api