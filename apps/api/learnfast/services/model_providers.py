from dataclasses import dataclass


@dataclass(frozen=True)
class ProviderDefinition:
    id: str
    role: str
    display_name: str
    base_url: str | None
    chat_models: tuple[str, ...]
    embedding_models: tuple[str, ...]
    capabilities: tuple[str, ...]
    live_test_kind: str
    requires_base_url: bool = False


PROVIDERS: dict[str, ProviderDefinition] = {
    "deepseek_chat": ProviderDefinition(
        id="deepseek_chat",
        role="chat",
        display_name="DeepSeek 聊天模型",
        base_url="https://api.deepseek.com",
        chat_models=(
            "deepseek-chat",
            "deepseek-reasoner",
            "deepseek-v4-flash",
            "deepseek-v4-pro",
        ),
        embedding_models=(),
        capabilities=("chat", "long_context", "structured_output"),
        live_test_kind="openai_models",
    ),
    "qwen_embedding": ProviderDefinition(
        id="qwen_embedding",
        role="embedding",
        display_name="Qwen 向量模型",
        base_url=None,
        chat_models=(),
        embedding_models=(
            "text-embedding-v4",
            "text-embedding-v3",
            "text-embedding-v2",
            "text-embedding-v1",
        ),
        capabilities=("embedding",),
        live_test_kind="openai_embeddings",
        requires_base_url=True,
    ),
}
