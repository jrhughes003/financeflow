import React from 'react';
import BudgetTuneUpPanel from './BudgetTuneUpPanel';
import GoalCheckPanel from './GoalCheckPanel';
import DebtStrategyPanel from './DebtStrategyPanel';
import { PanelGrid } from '../ui';

// Analytics → Plan: forward-looking checks on budgets, goals, and debts.
export default function PlanPanel() {
  return (
    <PanelGrid className="grid-flow-row-dense">
      <BudgetTuneUpPanel className="col-span-12 xl:col-span-7" />
      <GoalCheckPanel className="col-span-12 xl:col-span-5" />
      <DebtStrategyPanel className="col-span-12" />
    </PanelGrid>
  );
}
