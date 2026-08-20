import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabaseClient'
import ccLogo from './assets/CC Logo.png'
import favicon from './assets/favicon-32x32.png'
import './SubmitForm.css'

const CATEGORIES = ['Car', 'Bike', 'Truck', 'Boat', 'Engine', 'Motorsport', 'Other']
const MAX_DESCRIPTION_LENGTH = 500
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_FILE_SIZE = 100 * 1024 * 1024 // 100 MB
const MAX_TOTAL_SIZE = 200 * 1024 * 1024 // 200 MB for entire submission

function formatFileSize(bytes) {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

const CLOUDINARY_CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME
const CLOUDINARY_UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET
const CLOUDINARY_UPLOAD_URL = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/auto/upload`

const INITIAL_FORM = {
  name: '',
  handle: '',
  email: '',
  country: '',
  category: '',
  description: '',
  consent: false,
  website: '', // honeypot
}

let nextFileId = 0

function validate(form) {
  const errors = {}

  if (!form.name.trim()) errors.name = 'Name is required.'
  if (!form.handle.trim()) errors.handle = 'Instagram or TikTok handle is required.'

  if (!form.email.trim()) {
    errors.email = 'Email is required.'
  } else if (!EMAIL_REGEX.test(form.email.trim())) {
    errors.email = 'Enter a valid email address.'
  }

  if (!form.country.trim()) errors.country = 'Country is required.'
  if (!form.category) errors.category = 'Please select a category.'

  if (!form.description.trim()) {
    errors.description = 'A short description is required.'
  } else if (form.description.length > MAX_DESCRIPTION_LENGTH) {
    errors.description = `Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer.`
  }

  if (!form.consent) errors.consent = 'You must give consent to submit your content.'

  return errors
}

async function uploadFileToCloudinary(file) {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET)

  const response = await fetch(CLOUDINARY_UPLOAD_URL, {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    throw new Error('One or more files failed to upload. Please try again.')
  }

  const data = await response.json()
  return data.secure_url
}

function SubmitForm() {
  const [form, setForm] = useState(INITIAL_FORM)
  const [files, setFiles] = useState([])
  const [errors, setErrors] = useState({})
  const [fileError, setFileError] = useState('')
  const [status, setStatus] = useState('idle') // idle | submitting | success | error
  const [statusMessage, setStatusMessage] = useState('')
  const fileInputRef = useRef(null)

  // Set favicon on mount.
  useEffect(() => {
    const link = document.querySelector("link[rel='icon']")
    if (link) link.href = favicon
  }, [])

  // Revoke object URLs on unmount to avoid memory leaks.
  useEffect(() => {
    return () => {
      files.forEach((f) => URL.revokeObjectURL(f.previewUrl))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleChange(e) {
    const { name, value, type, checked } = e.target
    setForm((prev) => ({ ...prev, [name]: type === 'checkbox' ? checked : value }))
  }

  function handleFilesSelected(e) {
    const selected = Array.from(e.target.files || [])
    setFileError('')
    const oversizedFiles = []
    const validFiles = []

    selected.forEach((file) => {
      if (file.size > MAX_FILE_SIZE) {
        oversizedFiles.push(`${file.name} (${formatFileSize(file.size)})`)
      } else {
        validFiles.push(file)
      }
    })

    if (oversizedFiles.length > 0) {
      setFileError(
        `File(s) too large (max 100 MB each): ${oversizedFiles.join(', ')}`,
      )
    }

    if (validFiles.length > 0) {
      const totalSize = validFiles.reduce((sum, f) => sum + f.size, 0) +
        files.reduce((sum, f) => sum + f.file.size, 0)

      if (totalSize > MAX_TOTAL_SIZE) {
        setFileError(
          `Total file size exceeds 200 MB limit. Current total: ${formatFileSize(totalSize)}`,
        )
        e.target.value = ''
        return
      }

      const mapped = validFiles.map((file) => ({
        id: ++nextFileId,
        file,
        previewUrl: URL.createObjectURL(file),
        isVideo: file.type.startsWith('video/'),
      }))
      setFiles((prev) => [...prev, ...mapped])
    }

    e.target.value = '' // allow re-selecting the same file later
  }

  function removeFile(id) {
    setFiles((prev) => {
      const target = prev.find((f) => f.id === id)
      if (target) URL.revokeObjectURL(target.previewUrl)
      return prev.filter((f) => f.id !== id)
    })
    setFileError('')
  }

  function resetForm() {
    files.forEach((f) => URL.revokeObjectURL(f.previewUrl))
    setForm(INITIAL_FORM)
    setFiles([])
    setErrors({})
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function handleSubmit(e) {
    e.preventDefault()

    // Honeypot: bots that fill this hidden field get a fake success, nothing is sent.
    if (form.website.trim()) {
      setStatus('success')
      setStatusMessage('Thanks! Your submission has been received.')
      return
    }

    const validationErrors = validate(form)
    setErrors(validationErrors)
    if (Object.keys(validationErrors).length > 0) {
      setStatus('idle')
      return
    }

    setStatus('submitting')
    setStatusMessage('')

    try {
      const mediaUrls = await Promise.all(files.map((f) => uploadFileToCloudinary(f.file)))

      const { error } = await supabase.from('submissions').insert({
        name: form.name.trim(),
        handle: form.handle.trim(),
        email: form.email.trim(),
        country: form.country.trim(),
        category: form.category,
        description: form.description.trim(),
        media_urls: mediaUrls,
        consent: form.consent,
      })

      if (error) throw error

      // Send email notification (fail silently if it doesn't work)
      try {
        await fetch('/api/send-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: form.name.trim(),
            handle: form.handle.trim(),
            email: form.email.trim(),
            country: form.country.trim(),
            category: form.category,
            description: form.description.trim(),
            media_urls: mediaUrls,
          }),
        })
      } catch (emailErr) {
        console.error('Failed to send email notification:', emailErr)
        // Still show success to user even if email fails
      }

      resetForm()
      setStatus('success')
      setStatusMessage("Thanks for joining the cult! We've got your submission.")
    } catch (err) {
      setStatus('error')
      setStatusMessage(
        err instanceof Error ? err.message : 'Something went wrong. Please try again.',
      )
    }
  }

  const isSubmitting = status === 'submitting'
  const remainingChars = MAX_DESCRIPTION_LENGTH - form.description.length

  return (
    <div className="submit-form-page">
      <div className="submit-form-card">
        <header className="submit-form-header">
          <img src={ccLogo} alt="Combustion Cult" className="submit-form-logo" />
          <h1 className="submit-form-headline">Get Your Ride Featured. Win the Gear.</h1>
          <p className="submit-form-description">Submit your ride for a chance to be featured on Combustion Cult. Go into that month's draw to win a Combustion Cult Merch Pack.</p>
        </header>

        {status === 'success' ? (
          <div className="success-screen">
            <div className="submit-form-status success" role="status">
              {statusMessage}
            </div>
            <a href="https://www.combustioncult.com" target="_blank" rel="noopener noreferrer" className="website-button">
              Back to Combustion Cult
            </a>
          </div>
        ) : (
          <form className="submit-form" onSubmit={handleSubmit} noValidate>
            {status === 'error' && (
              <div className="submit-form-status error" role="alert">
                {statusMessage}
              </div>
            )}

            {/* Honeypot field: hidden offscreen, real users never see or fill it. */}
            <div className="hp-field" aria-hidden="true">
              <label htmlFor="website">Website</label>
              <input
                type="text"
                id="website"
                name="website"
                tabIndex={-1}
                autoComplete="off"
                value={form.website}
                onChange={handleChange}
              />
            </div>

            <div className="form-field">
              <label htmlFor="name">Name *</label>
              <input
                type="text"
                id="name"
                name="name"
                value={form.name}
                onChange={handleChange}
                aria-invalid={Boolean(errors.name)}
                aria-describedby={errors.name ? 'name-error' : undefined}
              />
              {errors.name && (
                <span className="field-error" id="name-error">
                  {errors.name}
                </span>
              )}
            </div>

            <div className="form-field">
              <label htmlFor="handle">Instagram or TikTok handle *</label>
              <input
                type="text"
                id="handle"
                name="handle"
                placeholder="@yourhandle"
                value={form.handle}
                onChange={handleChange}
                aria-invalid={Boolean(errors.handle)}
                aria-describedby={errors.handle ? 'handle-error' : undefined}
              />
              {errors.handle && (
                <span className="field-error" id="handle-error">
                  {errors.handle}
                </span>
              )}
            </div>

            <div className="form-field">
              <label htmlFor="email">Email *</label>
              <input
                type="text"
                id="email"
                name="email"
                value={form.email}
                onChange={handleChange}
                aria-invalid={Boolean(errors.email)}
                aria-describedby={errors.email ? 'email-error' : undefined}
              />
              {errors.email && (
                <span className="field-error" id="email-error">
                  {errors.email}
                </span>
              )}
            </div>

            <div className="form-field">
              <label htmlFor="country">Country *</label>
              <input
                type="text"
                id="country"
                name="country"
                value={form.country}
                onChange={handleChange}
                aria-invalid={Boolean(errors.country)}
                aria-describedby={errors.country ? 'country-error' : undefined}
              />
              {errors.country && (
                <span className="field-error" id="country-error">
                  {errors.country}
                </span>
              )}
            </div>

            <div className="form-field">
              <label htmlFor="category">Category *</label>
              <select
                id="category"
                name="category"
                value={form.category}
                onChange={handleChange}
                aria-invalid={Boolean(errors.category)}
                aria-describedby={errors.category ? 'category-error' : undefined}
              >
                <option value="">Select a category</option>
                {CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
              {errors.category && (
                <span className="field-error" id="category-error">
                  {errors.category}
                </span>
              )}
            </div>

            <div className="form-field">
              <label htmlFor="description">Short description / story *</label>
              <textarea
                id="description"
                name="description"
                rows={4}
                maxLength={MAX_DESCRIPTION_LENGTH}
                value={form.description}
                onChange={handleChange}
                aria-invalid={Boolean(errors.description)}
                aria-describedby={errors.description ? 'description-error' : 'description-count'}
              />
              <span className="char-count" id="description-count">
                {remainingChars} characters remaining
              </span>
              {errors.description && (
                <span className="field-error" id="description-error">
                  {errors.description}
                </span>
              )}
            </div>

            <div className="form-field">
              <label htmlFor="media">Photos / videos</label>
              <input
                type="file"
                id="media"
                name="media"
                accept="image/*,video/*"
                multiple
                ref={fileInputRef}
                onChange={handleFilesSelected}
              />
              <span className="file-info">Max 100 MB per file, 200 MB total</span>

              {fileError && (
                <span className="field-error" role="alert">
                  {fileError}
                </span>
              )}

              {files.length > 0 && (
                <ul className="file-preview-list">
                  {files.map((f) => (
                    <li key={f.id} className="file-preview-item">
                      {f.isVideo ? (
                        <video src={f.previewUrl} className="file-thumb" muted />
                      ) : (
                        <img src={f.previewUrl} alt="" className="file-thumb" />
                      )}
                      <div className="file-info-block">
                        <span className="file-name">{f.file.name}</span>
                        <span className="file-size">{formatFileSize(f.file.size)}</span>
                      </div>
                      <button
                        type="button"
                        className="file-remove"
                        onClick={() => removeFile(f.id)}
                        aria-label={`Remove ${f.file.name}`}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="form-field checkbox-field">
              <label htmlFor="consent">
                <input
                  type="checkbox"
                  id="consent"
                  name="consent"
                  checked={form.consent}
                  onChange={handleChange}
                  aria-invalid={Boolean(errors.consent)}
                  aria-describedby={errors.consent ? 'consent-error' : undefined}
                />
                <span>
                  I own this content or have permission to submit it, and give Combustion Cult
                  permission to publish, edit, and use it across its website, social media, and
                  promotional channels. *
                </span>
              </label>
              {errors.consent && (
                <span className="field-error" id="consent-error">
                  {errors.consent}
                </span>
              )}
            </div>

            <button type="submit" className="submit-button" disabled={isSubmitting}>
              {isSubmitting && <span className="spinner"></span>}
              <span>{isSubmitting ? 'Submitting' : 'Submit'}</span>
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

export default SubmitForm
