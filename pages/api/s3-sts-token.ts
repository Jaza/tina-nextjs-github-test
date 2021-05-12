import { NextApiRequest, NextApiResponse } from 'next'
import aws from 'aws-sdk'

// Code in this file is based on https://github.com/ryanto/next-s3-upload

type NextRouteHandler = (
  req: NextApiRequest,
  res: NextApiResponse
) => Promise<void>

type Configure = (options: Options) => Handler
type Handler = NextRouteHandler & { configure: Configure }

type Options = {
  key?: (req: NextApiRequest) => string
}

const makeRouteHandler = (options: Options = {}): Handler => {
  const route: NextRouteHandler = async function(req, res) {
    const missing = s3StsTokenMissingEnvs()
    if (missing.length > 0) {
      res
        .status(500)
        .json({ error: getS3StsTokenMissingEnvsMessage(missing) })
      return
    }

    const createdAt = Date.now()
    const policy = getS3StsPolicy(process.env.S3_UPLOAD_BUCKET)
    const token = await getS3StsToken(policy)

    res.statusCode = 200
    res.status(200).json({ token, createdAt })
  }

  const configure = (options: Options) => makeRouteHandler(options)
  return Object.assign(route, { configure })
}

const APIRoute = makeRouteHandler()
export default APIRoute

const S3_STS_TOKEN_REQUIRED_ENVS = [
  'S3_UPLOAD_KEY',
  'S3_UPLOAD_SECRET',
  'S3_UPLOAD_REGION',
  'S3_UPLOAD_BUCKET',
]

const s3StsTokenMissingEnvs = (): string[] => {
  return S3_STS_TOKEN_REQUIRED_ENVS.filter(key => !process.env[key])
}

const getS3StsTokenMissingEnvsMessage = (missing): string => {
  `S3 Media: Missing ENVs ${missing.join(', ')}`
}

const getS3StsPolicy = (bucket: string) => {
  return {
    Statement: [
      {
        Sid: 'S3ListAssets',
        Effect: 'Allow',
        Action: ['s3:ListBucket'],
        Resource: [`arn:aws:s3:::${bucket}`],
      },
      {
        Sid: 'S3CrudAssets',
        Effect: 'Allow',
        Action: ['s3:DeleteObject', 's3:PutObject', 's3:PutObjectAcl'],
        Resource: [`arn:aws:s3:::${bucket}/*`],
      },
    ],
  }
}

const getS3StsToken = async (policy) => {
  const config = {
    accessKeyId: process.env.S3_UPLOAD_KEY,
    secretAccessKey: process.env.S3_UPLOAD_SECRET,
    region: process.env.S3_UPLOAD_REGION,
  }

  const sts = new aws.STS(config)

  return await sts
    .getFederationToken({
      Name: 'S3UploadWebToken',
      Policy: JSON.stringify(policy),
      DurationSeconds: 60 * 60, // 1 hour
    })
    .promise()
}
