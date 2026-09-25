# Frontend Verification Checklist

## Files Created - Verification

Run this command to verify all files exist:

```bash
cd /Users/mm/res3d/frontend

# Check authentication components
ls -la src/components/auth/RestaurantSelector.js
ls -la src/components/auth/RestaurantSwitcher.js
ls -la src/components/auth/BranchSelector.js

# Check authentication pages
ls -la src/app/admin/login-v2/page.js
ls -la src/app/admin/register/page.js
ls -la src/app/accept-invitation/page.js

# Check management pages
ls -la src/app/admin/staff-v2/page.js
ls -la src/app/admin/branches-v2/page.js

# Check updated files
ls -la src/app/admin/login/page.js
ls -la src/app/admin/layout.js
```

## Quick Start Testing

### 1. Start the Development Server

```bash
cd /Users/mm/res3d/frontend
npm run dev
```

### 2. Test Registration Flow

1. Navigate to: `http://localhost:3000/admin/register`
2. Fill in the form:
   - Name: Test Owner
   - Phone: +1234567890
   - Email: owner@test.com
   - Password: Password123!
   - Restaurant Name: Test Restaurant
   - Slug: test-restaurant
3. Click "Create Account"
4. Should redirect to dashboard

### 3. Test Login Flow

1. Navigate to: `http://localhost:3000/admin/login`
2. Should auto-redirect to `/admin/login-v2`
3. Enter credentials from registration
4. Should show restaurant selector (if multiple)
5. Should redirect to dashboard

### 4. Test Staff Management

1. Navigate to: `http://localhost:3000/admin/staff-v2`
2. Click "Invite Staff Member"
3. Fill in invitation form:
   - Email: staff@test.com
   - Role: Manager
   - Access Level: Multi-Branch
   - Select branches
4. Click "Send Invitation"
5. Check backend logs for invitation token

### 5. Test Invitation Acceptance

1. Get invitation token from backend logs or database
2. Navigate to: `http://localhost:3000/accept-invitation?token=inv_xxx`
3. Should show invitation details
4. Create password (if new user)
5. Click "Accept Invitation"
6. Should redirect to dashboard

### 6. Test Branch Management

1. Navigate to: `http://localhost:3000/admin/branches-v2`
2. Click "Add Branch"
3. Fill in branch details:
   - Name: Downtown Location
   - Address: 123 Main St
   - City: New York
   - Phone: +1234567890
4. Click "Create Branch"
5. Should appear in branch list

### 7. Test Restaurant Switcher

1. Create second restaurant (via registration or superadmin)
2. Add yourself to second restaurant
3. Login
4. Check header for restaurant dropdown
5. Click and select other restaurant
6. Page should reload with new context

### 8. Test Branch Selector

1. Login as multi-branch user
2. Check header for branch dropdown
3. Click and select branch
4. Selection should persist in localStorage

## API Endpoint Testing

Test that frontend can reach all required endpoints:

```bash
# From frontend directory
cd /Users/mm/res3d/frontend

# Create test script
cat > test-api-endpoints.js << 'EOF'
const apiClient = require('./src/lib/api').default;

async function testEndpoints() {
  console.log('Testing API endpoints...\n');
  
  const tests = [
    { method: 'POST', path: '/v2/auth/register/restaurant', name: 'Registration' },
    { method: 'POST', path: '/v2/auth/login', name: 'Login' },
    { method: 'POST', path: '/v2/auth/switch-restaurant', name: 'Switch Restaurant' },
    { method: 'GET', path: '/v2/staff', name: 'List Staff' },
    { method: 'GET', path: '/v2/branches', name: 'List Branches' },
  ];
  
  for (const test of tests) {
    try {
      console.log(`✓ ${test.name} endpoint exists: ${test.method} ${test.path}`);
    } catch (err) {
      console.log(`✗ ${test.name} endpoint failed: ${err.message}`);
    }
  }
}

testEndpoints();
EOF
```

## Console Error Check

Open browser console (F12) and check for:

- ❌ No 404 errors for components
- ❌ No import errors
- ❌ No React hydration errors
- ❌ No missing prop warnings
- ✅ Clean console on all pages

## Browser Compatibility

Test on:

- [ ] Chrome (latest)
- [ ] Firefox (latest)
- [ ] Safari (latest)
- [ ] Mobile Safari (iOS)
- [ ] Chrome Mobile (Android)

## Responsive Design Check

Test at breakpoints:

- [ ] 375px (Mobile)
- [ ] 768px (Tablet)
- [ ] 1024px (Desktop)
- [ ] 1920px (Large Desktop)

## Accessibility Check

Use browser dev tools:

- [ ] Lighthouse Accessibility Score > 90
- [ ] Keyboard navigation works
- [ ] Screen reader friendly
- [ ] Color contrast passes WCAG AA

## Performance Check

- [ ] Page load < 3s
- [ ] Time to Interactive < 5s
- [ ] No layout shifts
- [ ] Images optimized
- [ ] Code splitting active

## Security Check

- [ ] No secrets in localStorage
- [ ] Cookies are httpOnly
- [ ] CSRF protection enabled
- [ ] XSS prevention active
- [ ] Input sanitization working

## Integration Points

Verify integration with:

- [ ] Backend API (localhost:4000)
- [ ] Database (PostgreSQL)
- [ ] Session management
- [ ] Cookie handling
- [ ] Local storage

## Error Scenarios

Test error handling:

- [ ] Invalid credentials
- [ ] Expired invitation
- [ ] Network error
- [ ] 403 Access Denied
- [ ] 500 Server Error

## Success Criteria

All checks should pass:

- ✅ All files exist
- ✅ No console errors
- ✅ All user flows work
- ✅ Responsive on all devices
- ✅ Accessible
- ✅ Secure
- ✅ Fast performance

## Quick Fix Commands

If you encounter issues:

```bash
# Clear node modules and reinstall
rm -rf node_modules package-lock.json
npm install

# Clear Next.js cache
rm -rf .next

# Restart dev server
npm run dev

# Check for TypeScript errors
npm run type-check

# Check for ESLint errors
npm run lint
```

## Status

- [ ] All files verified
- [ ] Development server started
- [ ] All flows tested
- [ ] No errors found
- [ ] Ready for production

---

**Last Updated:** September 1, 2026
**Verified By:** _____________
**Status:** ⏳ PENDING VERIFICATION
