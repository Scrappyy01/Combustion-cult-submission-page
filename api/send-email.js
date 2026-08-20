import nodemailer from 'nodemailer'

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT, 10),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD,
  },
})

export default async function handler(req, res) {
  // Only accept POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { name, handle, email, country, category, description, media_urls } = req.body

    // Validate required fields
    if (!name || !handle || !email || !country || !category || !description) {
      return res.status(400).json({ error: 'Missing required fields' })
    }

    // Build HTML email
    const mediaLinksHtml =
      media_urls && media_urls.length > 0
        ? `
        <h3>Media:</h3>
        <ul>
          ${media_urls.map((url) => `<li><a href="${url}" target="_blank">${url}</a></li>`).join('')}
        </ul>
      `
        : '<p><em>No media attached</em></p>'

    const htmlContent = `
      <h2>New Submission from Combustion Cult</h2>
      <p><strong>Name:</strong> ${name}</p>
      <p><strong>Handle:</strong> ${handle}</p>
      <p><strong>Email:</strong> ${email}</p>
      <p><strong>Country:</strong> ${country}</p>
      <p><strong>Category:</strong> ${category}</p>
      <p><strong>Description:</strong></p>
      <p>${description.replace(/\n/g, '<br>')}</p>
      ${mediaLinksHtml}
    `

    // Send email
    await transporter.sendMail({
      from: process.env.SMTP_USER,
      to: process.env.SMTP_USER, // Send to media@combustioncult.com
      subject: `New Submission: ${name} - ${category}`,
      html: htmlContent,
      replyTo: email,
    })

    return res.status(200).json({ success: true })
  } catch (error) {
    console.error('Email send error:', error)
    return res.status(500).json({ error: 'Failed to send email' })
  }
}
