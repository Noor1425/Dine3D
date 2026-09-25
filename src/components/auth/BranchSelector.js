'use client';

import { useState, useEffect } from 'react';
import { Building2, ChevronDown, Check, MapPin } from 'lucide-react';

/**
 * Branch Selector Component
 * Dropdown for multi-branch users to filter content by branch
 * Shows "All Branches" for corporate users
 */
export default function BranchSelector({ 
  currentBranch, 
  branches = [], 
  accessLevel = 'branch',
  onChange 
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState(currentBranch);

  useEffect(() => {
    setSelectedBranch(currentBranch);
  }, [currentBranch]);

  const handleSelect = (branch) => {
    setSelectedBranch(branch);
    setIsOpen(false);
    onChange?.(branch);
  };

  // Single branch users don't need a selector
  if (accessLevel === 'branch' && branches.length <= 1) {
    return (
      <div className="flex min-w-0 max-w-full items-center space-x-2 rounded-lg bg-gray-50 px-3 py-2">
        <MapPin className="h-4 w-4 flex-shrink-0 text-gray-600" />
        <span className="min-w-0 truncate text-sm font-medium text-gray-900">
          {selectedBranch?.name || 'No Branch'}
        </span>
      </div>
    );
  }

  // Corporate users see "All Branches" by default
  const displayBranches = accessLevel === 'corporate' 
    ? [{ id: 'all', name: 'All Branches' }, ...branches]
    : branches;

  const displayName = selectedBranch?.id === 'all' 
    ? 'All Branches'
    : selectedBranch?.name || 'Select Branch';

  return (
    <div className="relative min-w-0 max-w-full">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full min-w-0 max-w-[240px] items-center space-x-2 rounded-lg border border-gray-300 bg-white px-3 py-2 transition-colors hover:bg-gray-50 sm:min-w-[200px]"
      >
        <MapPin className="w-4 h-4 text-gray-600 flex-shrink-0" />
        <span className="text-sm font-medium text-gray-900 flex-1 text-left truncate">
          {displayName}
        </span>
        <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform flex-shrink-0 ${
          isOpen ? 'rotate-180' : ''
        }`} />
      </button>

      {isOpen && (
        <>
          {/* Overlay */}
          <div
            className="fixed inset-0 z-10"
            onClick={() => setIsOpen(false)}
          />
          
          {/* Dropdown */}
          <div className="fixed left-3 right-3 top-16 z-20 max-h-96 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg sm:absolute sm:left-0 sm:right-auto sm:top-full sm:mt-2 sm:w-[min(320px,calc(100vw-2rem))]">
            <div className="p-2">
              {displayBranches.map((branch) => (
                <button
                  key={branch.id}
                  onClick={() => handleSelect(branch)}
                  className={`w-full flex items-center justify-between p-3 rounded-lg hover:bg-gray-50 transition-colors text-left ${
                    selectedBranch?.id === branch.id ? 'bg-blue-50' : ''
                  }`}
                >
                  <div className="flex items-center space-x-3 flex-1 min-w-0">
                    {branch.id === 'all' ? (
                      <div className="w-8 h-8 rounded bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center flex-shrink-0">
                        <Building2 className="w-4 h-4 text-white" />
                      </div>
                    ) : (
                      <div className="w-8 h-8 rounded bg-gray-100 flex items-center justify-center flex-shrink-0">
                        <MapPin className="w-4 h-4 text-gray-600" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-gray-900 truncate">{branch.name}</p>
                      {branch.address && (
                        <p className="text-xs text-gray-500 truncate">{branch.city || branch.address}</p>
                      )}
                    </div>
                  </div>
                  {selectedBranch?.id === branch.id && (
                    <Check className="w-5 h-5 text-blue-600 flex-shrink-0 ml-2" />
                  )}
                </button>
              ))}
            </div>

            {displayBranches.length === 0 && (
              <div className="p-4 text-center text-sm text-gray-500">
                No branches available
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
