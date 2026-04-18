# AnimaImagineSkill v2 Docker配置
# 多阶段构建：基础镜像带 CUDA + PyTorch，应用层轻量。
#
# 构建：
#   docker build -t anima-imagine .
# 运行：
#   docker compose up -d

FROM nvidia/cuda:12.4.0-runtime-ubuntu22.04 AS base

# 系统依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.13 python3.13-venv python3-pip curl \
    && rm -rf /var/lib/apt/lists/*

# 安装 uv
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
ENV PATH="/root/.local/bin:$PATH"

WORKDIR /app

# 先复制依赖文件，利用缓存
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

# 复制应用代码
COPY src/ src/
COPY AnimaImagineSkill/ AnimaImagineSkill/
COPY config.example.yaml ./

# 数据卷挂载点
VOLUME ["/app/models", "/app/output", "/app/config.yaml"]

# 默认端口
EXPOSE 8000

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# 启动
CMD ["uv", "run", "anima-imagine"]
