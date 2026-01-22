#!/bin/bash

# Telegram Bot PM2 部署脚本
# 用于在 Ubuntu 服务器上自动化部署和管理应用

set -e  # 遇到错误立即退出

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 打印带颜色的消息
print_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 检查命令是否存在
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# 检查 PM2 是否安装
check_pm2() {
    if ! command_exists pm2; then
        print_warn "PM2 未安装，正在安装..."
        npm install -g pm2
        if [ $? -eq 0 ]; then
            print_info "PM2 安装成功"
        else
            print_error "PM2 安装失败，请手动安装: npm install -g pm2"
            exit 1
        fi
    else
        print_info "PM2 已安装: $(pm2 --version)"
    fi
}

# 检查 Node.js 是否安装
check_node() {
    if ! command_exists node; then
        print_error "Node.js 未安装，请先安装 Node.js >= 16.x"
        exit 1
    else
        print_info "Node.js 版本: $(node --version)"
    fi
}

# 检查 .env 文件是否存在
check_env() {
    if [ ! -f .env ]; then
        print_warn ".env 文件不存在"
        if [ -f .env.example ]; then
            print_info "从 .env.example 创建 .env 文件"
            cp .env.example .env
            print_warn "请编辑 .env 文件并填写必要的配置信息"
        else
            print_error ".env 文件不存在，请创建并配置环境变量"
            exit 1
        fi
    else
        print_info ".env 文件存在"
    fi
}

# 创建日志目录
create_log_dir() {
    if [ ! -d logs ]; then
        mkdir -p logs
        print_info "创建日志目录: logs/"
    fi
}

# 安装依赖
install_dependencies() {
    print_info "安装项目依赖..."
    npm install
    if [ $? -eq 0 ]; then
        print_info "依赖安装成功"
    else
        print_error "依赖安装失败"
        exit 1
    fi
}

# 启动应用
start_app() {
    print_info "启动应用..."
    
    # 检查应用是否已在运行
    if pm2 list | grep -q "telegram-bot"; then
        print_warn "应用已在运行，正在重启..."
        pm2 restart ecosystem.config.js
    else
        pm2 start ecosystem.config.js
    fi
    
    if [ $? -eq 0 ]; then
        print_info "应用启动成功"
        pm2 status
    else
        print_error "应用启动失败"
        exit 1
    fi
}

# 显示使用说明
show_usage() {
    echo ""
    echo "使用方法:"
    echo "  ./deploy.sh [命令]"
    echo ""
    echo "命令:"
    echo "  start      - 启动应用（默认）"
    echo "  stop       - 停止应用"
    echo "  restart    - 重启应用"
    echo "  reload     - 零停机重启应用"
    echo "  status     - 查看应用状态"
    echo "  logs       - 查看应用日志"
    echo "  monit      - 打开监控面板"
    echo "  save       - 保存当前进程列表"
    echo "  startup    - 设置开机自启"
    echo "  delete     - 删除应用"
    echo "  help       - 显示此帮助信息"
    echo ""
}

# 主函数
main() {
    case "${1:-start}" in
        start)
            print_info "开始部署 Telegram Bot..."
            check_node
            check_pm2
            check_env
            create_log_dir
            install_dependencies
            start_app
            print_info "部署完成！"
            echo ""
            print_info "常用命令:"
            echo "  查看状态: pm2 status"
            echo "  查看日志: pm2 logs telegram-bot"
            echo "  重启应用: pm2 restart telegram-bot"
            echo "  设置开机自启: pm2 startup && pm2 save"
            ;;
        stop)
            print_info "停止应用..."
            pm2 stop telegram-bot
            ;;
        restart)
            print_info "重启应用..."
            pm2 restart telegram-bot
            ;;
        reload)
            print_info "零停机重启应用..."
            pm2 reload telegram-bot
            ;;
        status)
            pm2 status
            pm2 info telegram-bot
            ;;
        logs)
            pm2 logs telegram-bot
            ;;
        monit)
            pm2 monit
            ;;
        save)
            print_info "保存当前进程列表..."
            pm2 save
            ;;
        startup)
            print_info "设置开机自启..."
            pm2 startup
            print_info "请运行上面的命令，然后执行: pm2 save"
            ;;
        delete)
            print_warn "删除应用..."
            pm2 delete telegram-bot
            ;;
        help|--help|-h)
            show_usage
            ;;
        *)
            print_error "未知命令: $1"
            show_usage
            exit 1
            ;;
    esac
}

# 执行主函数
main "$@"
