using Manapoint.Models;

namespace Manapoint.Collectors;

/// <summary>一個服務的用量取數器。</summary>
public interface IUsageCollector
{
    string ProviderName { get; }

    Task<ProviderUsage> CollectAsync(CancellationToken ct = default);
}
