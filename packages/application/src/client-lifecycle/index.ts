// ClientLifecycle module public barrel (Architecture §6.3, §11, §12).
// Owns: Client, Subscription, WorkoutPlan/PlanDay, TrainingSession, Evaluation,
// EvaluationSchedule, SatisfactionRecord use cases and the WorkflowDefinition/
// LifecycleStep pipeline. Only this file is importable from outside this folder.
// Landing starting Level 2.3.

export const CLIENT_LIFECYCLE_MODULE = 'client-lifecycle';
