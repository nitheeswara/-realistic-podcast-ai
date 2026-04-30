# Realistic Podcast AI

Realistic Podcast AI is a Next.js App Router studio for producing scripted podcast videos with AI script generation, voice selection, avatar setup, generation progress, exports, and Phase 3 voice/avatar cloning. The project uses strict TypeScript, Zod contracts, Firebase Auth/Firestore, Firebase Admin routes, Cloudinary media storage, shadcn/ui, Tailwind CSS, and Framer Motion.

## Stack

- Next.js 16 App Router with `src/`
- TypeScript strict mode
- Tailwind CSS 4
- shadcn/ui primitives
- Firebase Auth, Firestore, and Firebase Admin
- Gemini script generation on server routes
- ElevenLabs and Sarvam voice routes on the server
- HeyGen stock and photo-avatar routes on the server
- Cloudinary media uploads
- FFmpeg via `ffmpeg-static`
- Optional Python lipsync service for Wav2Lip/SadTalker integration

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env.local` in the project root:

```bash
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=

FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=

GEMINI_API_KEY=
ELEVENLABS_API_KEY=
SARVAM_API_KEY=
HEYGEN_API_KEY=
SYNCLABS_API_KEY=
DID_API_KEY=
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=

APP_BASE_URL=http://localhost:3000
PYTHON_SERVICE_URL=
FFMPEG_PATH=
```

3. Add Firebase web app values from Firebase project settings.

4. Add a Firebase service account for Admin SDK access. Keep `FIREBASE_PRIVATE_KEY` quoted if it contains escaped newline characters.

5. Deploy Firestore rules when your Firebase project is ready:

```bash
firebase deploy --only firestore:rules
```

6. Run the app:

```bash
npm run dev
```

7. Open `http://localhost:3000`. The root route redirects to `/login`.

## Optional Python Service

The video worker can call a local Python service when `PYTHON_SERVICE_URL` is set.

```bash
cd python-services
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Then set:

```bash
PYTHON_SERVICE_URL=http://127.0.0.1:8000
```

The included Wav2Lip endpoint is a passthrough stub until model assets are installed. SadTalker returns a clear 501 until its model bundle is added.

## Phase Roadmap

- Phase 1: Env validation, Firebase client/admin setup, auth pages, protected dashboard, shared types, README foundation.
- Phase 2: Podcast creation wizard, Gemini script generation, script editor, voice/avatar setup, studio settings, video jobs, generation progress, result page.
- Phase 3: Voice cloning, avatar cloning, clone matrix UI, clone library, Wav2Lip/SadTalker service hooks.
- Phase 4: Credits, billing, plan limits, render quota controls.
- Phase 5: Worker hardening, durable queues, observability, retries, production asset cleanup.
- Phase 6: Team workflows, sharing permissions, production security review.

## Scripts

```bash
npm run dev
npm run build
npm run lint
```
