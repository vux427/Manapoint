namespace Manapoint.Collectors;

/// <summary>
/// 服務尚未可用——未安裝、未登入、或登入已過期。
/// 訊息會直接顯示給使用者，必須寫成可以照著做的指示。
/// </summary>
public sealed class ProviderNotReadyException(string message) : Exception(message);
