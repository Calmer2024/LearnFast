from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from learnfast.api.routes import chat, health, model_settings, search, sources, spaces, system_logs
from learnfast.core.config import get_settings
from learnfast.infrastructure.database import init_db
from learnfast.infrastructure.storage import ensure_data_dirs


def create_app() -> FastAPI:
    settings = get_settings()
    ensure_data_dirs()
    init_db()

    app = FastAPI(title=settings.app_name, version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(health.router, prefix=settings.api_prefix)
    app.include_router(model_settings.router, prefix=settings.api_prefix)
    app.include_router(spaces.router, prefix=settings.api_prefix)
    app.include_router(sources.router, prefix=settings.api_prefix)
    app.include_router(search.router, prefix=settings.api_prefix)
    app.include_router(chat.router, prefix=settings.api_prefix)
    app.include_router(system_logs.router, prefix=settings.api_prefix)
    return app


app = create_app()
