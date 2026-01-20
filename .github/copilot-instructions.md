# Barbearia do Rod - AI Coding Agent Instructions

## Project Overview
This is a full-stack web application for a barbershop appointment scheduling system. The backend is built with Node.js/Express and MongoDB, while the frontend uses vanilla HTML/CSS/JavaScript with no frameworks.

## Architecture
- **Backend** (`backend/`): Express server with MongoDB Atlas, user authentication, appointment management, and email notifications
- **Frontend**: Static HTML pages served directly by browser, with client-side JavaScript for interactivity
- **Database**: MongoDB with two main collections: `usuarios` (users) and `agendamentos` (appointments)
- **Authentication**: Session-based using localStorage, no JWT tokens

## Key Components
- `backend/index.js`: Main server file with all API routes
- `Rod.html`: Main landing page with appointment form
- `login.html` & `cadastro.html`: Authentication pages
- `admin.html`: Admin dashboard for managing appointments
- `rod.js`: Client-side logic for appointment submission

## Data Flow
1. Users register via `cadastro.html` → POST to `/cadastro`
2. Login via `login.html` → POST to `/login`, stores user data in localStorage
3. If admin email (`davizaia1345@gmail.com`), redirects to `admin.html`
4. Regular users can schedule appointments on `Rod.html` → POST to `/agendar`
5. Admin can view all appointments via GET `/agendamentos` and delete via DELETE `/agendamentos/:id`

## Developer Workflows
- **Start Backend**: `cd backend && npm install && node index.js` (runs on port 3001)
- **Frontend**: Open HTML files directly in browser (no server needed)
- **Database**: Uses MongoDB Atlas - connection string in `backend/index.js`
- **Email**: Configured for Gmail SMTP in `backend/index.js` and `backend/teste.js`

## Project-Specific Patterns
- **Language**: All user-facing text in Portuguese
- **Admin Access**: Hardcoded email check in `login.html` for admin routing
- **Session Management**: Relies on localStorage for user state across pages
- **Error Handling**: Basic try/catch with alert() for user feedback
- **Styling**: Custom CSS in `rod.css`, uses Font Awesome icons
- **API Calls**: Direct fetch() to `http://localhost:3001` endpoints
- **Email Templates**: HTML email confirmations sent via nodemailer
- **Conflict Prevention**: Checks for duplicate date/time slots before saving appointments

## Common Tasks
- **Add new service**: Update price list in `Rod.html` and potentially backend validation
- **Modify admin email**: Change hardcoded check in `login.html` and update email config
- **Add form validation**: Extend client-side checks in JavaScript before API calls
- **Update email template**: Modify HTML string in `backend/index.js` `/agendar` route
- **Add new admin features**: Extend `admin.html` with new fetch calls to backend endpoints

## Dependencies
- **Backend**: express, mongoose, bcrypt, cors, dotenv, nodemailer
- **Frontend**: None (vanilla JS), Font Awesome via CDN
- **Database**: MongoDB Atlas (cloud-hosted)

## Security Notes
- Passwords hashed with bcrypt (10 rounds)
- CORS enabled for cross-origin requests
- Email credentials stored in code (consider environment variables for production)
- Admin access via hardcoded email check (not scalable)

## File Structure
```
/
├── backend/
│   ├── index.js          # Main server
│   ├── package.json      # Backend deps
│   └── teste.js          # Email testing script
├── *.html                # Frontend pages
├── rod.css               # Styles
├── rod.js                # Client logic
└── package.json          # Root config
```</content>
<parameter name="filePath">vsls:/.github/copilot-instructions.md