import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LayoutDashboard, Server, ShieldAlert, CheckSquare, BarChart3 } from 'lucide-react';

export const BottomNav: React.FC = () => {
  const { t } = useTranslation('nav');
  const location = useLocation();

  const tabs = [
    { path: '/',       icon: LayoutDashboard, label: 'Dashboard'               },
    { path: '/assets', icon: Server,          label: t('items.assets.label')   },
    { path: '/risks',  icon: ShieldAlert,     label: t('items.risks.label')    },
    { path: '/tasks',  icon: CheckSquare,     label: t('items.tasks.label')    },
    { path: '/report', icon: BarChart3,       label: t('items.report.label')   },
  ];
  const isActive = (path: string) =>
    path === '/' ? location.pathname === '/' : location.pathname.startsWith(path);

  return (
    <nav className="fixed bottom-0 inset-x-0 z-40 md:hidden bg-white dark:bg-slate-900 border-t border-gray-200 dark:border-slate-800 flex">
      {tabs.map(({ path, icon: Icon, label }) => {
        const active = isActive(path);
        return (
          <Link
            key={path}
            to={path}
            className={`flex-1 flex flex-col items-center justify-center py-2 gap-0.5 text-[10px] font-medium transition-colors ${
              active
                ? 'text-blue-600 dark:text-blue-400'
                : 'text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300'
            }`}
          >
            <Icon size={20} strokeWidth={active ? 2.5 : 1.5} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
};
