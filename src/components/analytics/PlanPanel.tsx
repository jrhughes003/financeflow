import React from 'react';
import BudgetTuneUpPanel from './BudgetTuneUpPanel';
import GoalCheckPanel from './GoalCheckPanel';
import DebtStrategyPanel from './DebtStrategyPanel';

// Analytics → Plan: forward-looking checks on budgets, goals, and debts.
export default function PlanPanel() {
  return (
    <div className="space-y-5">
      <BudgetTuneUpPanel />
      <GoalCheckPanel />
      <DebtStrategyPanel />
    </div>
  );
}
