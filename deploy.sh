#!/bin/bash
# HR智能审稿机器人 - 一键部署脚本

set -e

echo "=== HR智能审稿机器人 - 部署开始 ==="

# 检查 Python
if ! command -v python3 &> /dev/null; then
    echo "❌ 请先安装 Python 3.12+"
    exit 1
fi

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "❌ 请先安装 Node.js 18+"
    exit 1
fi

# 安装后端依赖
echo "[1/3] 安装后端依赖..."
cd backend
pip install -r requirements.txt

# 安装前端依赖
echo "[2/3] 安装前端依赖..."
cd ../frontend
npm install

# 构建前端
echo "[3/3] 构建前端..."
npm run build

echo "=== 部署完成 ==="
echo ""
echo "启动方式:"
echo "  后端: cd backend && python app.py"
echo "  前端开发: cd frontend && npm run dev"
echo "  访问: http://localhost:5173"
echo "  默认账号: admin / admin123"