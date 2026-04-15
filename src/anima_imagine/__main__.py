"""
允许 python -m anima_imagine 直接启动服务。
等价于命令行 anima-imagine。
"""
from anima_imagine.server import main

if __name__ == "__main__":
    main()
