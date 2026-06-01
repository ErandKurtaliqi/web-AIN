namespace SchedulingAPI.Models;

// ── Inbound requests (from Angular → .NET, already camelCase) ────────────────

public class RunRequest
{
    public string Instance { get; set; } = string.Empty;
    public string Algorithm { get; set; } = "hill_climbing_restarts";
    public List<string> Operators { get; set; } = ["replace", "swap", "shift_borders"];
    public int MaxIterations { get; set; } = 200;
    public int NumRestarts { get; set; } = 3;
    public int InsertionInterval { get; set; } = 50;
    public int MaxShift { get; set; } = 10;
    public int MaxExecutionSeconds { get; set; } = 30;
}

public class ConfigEntry
{
    public string Label { get; set; } = "Config";
    public List<string> Operators { get; set; } = ["replace", "swap", "shift_borders"];
    public int MaxIterations { get; set; } = 200;
    public int NumRestarts { get; set; } = 3;
    public int InsertionInterval { get; set; } = 50;
    public int MaxShift { get; set; } = 10;
    public int MaxExecutionSeconds { get; set; } = 30;
}

public class CompareRequest
{
    public string Instance { get; set; } = string.Empty;
    public List<ConfigEntry> Configurations { get; set; } = [];
}

public class ReoptimizeRequest
{
    public string Instance { get; set; } = string.Empty;
    public List<string> Operators { get; set; } = ["replace", "swap", "shift_borders"];
    public int MaxIterations { get; set; } = 200;
    public int NumRestarts { get; set; } = 3;
    public int InsertionInterval { get; set; } = 50;
    public int MaxShift { get; set; } = 10;
    public int MaxExecutionSeconds { get; set; } = 30;
}

// ── Outbound results (Python snake_case → C# PascalCase → Angular camelCase) ─
// No [JsonPropertyName] here — deserialization from Python uses SnakeCaseLower
// policy (see JsonOptions.PythonIn), serialization to Angular via SignalR uses
// the default camelCase policy so Angular gets executionTime, progressHistory, etc.

public class ScheduledProgramDto
{
    public string ProgramId { get; set; } = string.Empty;
    public int ChannelId { get; set; }
    public int Start { get; set; }
    public int End { get; set; }
}

public class PenaltyBreakdown
{
    public double BaseScore { get; set; }
    public double BonusEarned { get; set; }
    public int ChannelSwitches { get; set; }
    public double SwitchPenaltyTotal { get; set; }
    public int TimingViolations { get; set; }
    public double TimingPenaltyTotal { get; set; }
    public double FinalScore { get; set; }
}

public class OperatorStat
{
    public int Calls { get; set; }
    public int Improvements { get; set; }
    public double ScoreDelta { get; set; }
}

public class ProgressPoint
{
    public int Iteration { get; set; }
    public double Score { get; set; }
    public double CurrentScore { get; set; }
    public double BestScore { get; set; }
}

public class ScheduleResult
{
    public double Score { get; set; }
    public double ExecutionTime { get; set; }
    public int Conflicts { get; set; }
    public double InitialScore { get; set; }
    public double ScoreImprovement { get; set; }
    public string Algorithm { get; set; } = string.Empty;
    public string Instance { get; set; } = string.Empty;
    public List<string> Operators { get; set; } = [];
    public PenaltyBreakdown? PenaltyBreakdown { get; set; }
    public Dictionary<string, OperatorStat>? OperatorStats { get; set; }
    public List<ProgressPoint>? ProgressHistory { get; set; }
    public List<ScheduledProgramDto>? ScheduledPrograms { get; set; }
    public string? Label { get; set; }
}

public class CompareResult
{
    public string Instance { get; set; } = string.Empty;
    public List<ScheduleResult> Results { get; set; } = [];
    public string BestLabel { get; set; } = string.Empty;
    public double BestScore { get; set; }
}

// ── SignalR messages ──────────────────────────────────────────────────────────

public class StatusMessage
{
    public string Status { get; set; } = string.Empty;   // "running" | "completed" | "error" | "cancelled"
    public string Message { get; set; } = string.Empty;
    public ScheduleResult? Result { get; set; }
}
