import { Compass, Search, ListMusic } from 'lucide-react';
import type { TabKey } from '../types';

const TABS: { key: TabKey; label: string; icon: typeof Compass }[] = [
  { key: 'recommend', label: '推荐', icon: Compass },
  { key: 'search', label: '搜索', icon: Search },
  { key: 'queue', label: '队列', icon: ListMusic },
];

interface TabBarProps {
  active: TabKey;
  onChange: (tab: TabKey) => void;
}

export default function TabBar({ active, onChange }: TabBarProps) {
  return (
    <nav className="tab-bar">
      {TABS.map((tab) => {
        const Icon = tab.icon;
        const isActive = active === tab.key;
        return (
          <button
            key={tab.key}
            className={`tab-item ${isActive ? 'active' : ''}`}
            onClick={() => onChange(tab.key)}
            aria-current={isActive ? 'page' : undefined}
          >
            <Icon size={18} strokeWidth={isActive ? 2.4 : 1.8} />
            <span>{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
