import {
  MediaStore,
  MediaUploadOptions,
  Media,
  MediaList,
  MediaListOptions,
} from '@tinacms/core'
import S3 from 'aws-sdk/clients/s3'

export class NextS3MediaStore implements MediaStore {
  s3Bucket: string
  s3ReadUrl?: string
  s3ServerSideEncryption?: string
  s3StsToken?: string
  s3StsTokenCreatedAt?: number
  accept = '*'

  constructor({
    s3Bucket,
    s3ReadUrl = null,
    s3ServerSideEncryption = null,
  }: S3MediaStoreOptions) {
    this.s3Bucket = s3Bucket
    this.s3ReadUrl = s3ReadUrl ?? `//${s3Bucket}.${S3_DEFAULT_DOMAIN}`
    this.s3ServerSideEncryption = s3ServerSideEncryption
    this.s3StsToken = null
    this.s3StsTokenCreatedAt = null
  }

  async persist(files: MediaUploadOptions[]): Promise<Media[]> {
    const uploaded: Media[] = []

    for (const { directory, file } of files) {
      const token = await this.getS3StsToken()
      const uploadResult: S3UploadObject = await uploadToS3(
        token, this.s3Bucket, directory, file, this.s3ServerSideEncryption
      )
      uploaded.push(objectToMedia(uploadResult, this.s3ReadUrl))
    }

    return uploaded
  }

  async previewSrc(filename: string) {
    return `${this.s3ReadUrl}${this.s3ReadUrl.endsWith('/') ? '' : '/'}`
      + filename.replace(/^\/+/, '')
  }

  async list(options?: MediaListOptions): Promise<MediaList> {
    const directory = options?.directory ?? ''
    const offset = options?.offset ?? 0
    const limit = options?.limit ?? 1000
    const items: Media[] = []

    // TODO: implement paging (offset and limit)
    const token = await this.getS3StsToken()
    const listResult = await listInS3(token, this.s3Bucket, directory)

    // List child directories
    const prefixItems: S3PrefixObject[] = listResult.CommonPrefixes
    for (const prefixItem of prefixItems) {
      items.push(prefixToMedia(prefixItem))
    }

    // List files in current directory
    const resultItems: S3ListObject[] = listResult.Contents
    for (const resultItem of resultItems) {
      items.push(objectToMedia(resultItem, this.s3ReadUrl))
    }

    return {
      items,
      offset,
      limit,
      totalCount: items.length,
    }
  }

  async delete(media: Media) {
    const token = await this.getS3StsToken()
    await deleteFromS3(token, this.s3Bucket, media.id)
  }

  private async getS3StsToken() {
    if (isNonExpiredS3StsToken(this.s3StsToken, this.s3StsTokenCreatedAt)) {
      return this.s3StsToken
    }

    // There's no token in the state, or the token has expired (or is about to
    // expire), so request a new one
    const data = await getNewS3StsToken()

    this.s3StsToken = data.token
    this.s3StsTokenCreatedAt = data.createdAt

    return this.s3StsToken
  }
}

export interface S3MediaStoreOptions {
  s3Bucket: string
  s3ReadUrl?: string
  s3ServerSideEncryption?: string
}

interface S3UploadObject {
  Location: string
  ETag: string
  Bucket: string
  Key: string
}

interface S3PrefixObject {
  Prefix: string
}

interface S3ListObject {
  LastModified: Date
  ETag: string
  Size: number
  Key: string
  StorageClass: string
}

const S3_DEFAULT_DOMAIN = 's3.amazonaws.com'

const listInS3 = async (token, bucket: string, directory: string) => {
  const s3 = getS3(token)
  const directoryTrimmed = directory.replace(/^\//, '').replace(/\/$/, '')

  // TODO: implement paging (offset and limit)
  const params = {
    Bucket: bucket,
    Delimiter: '/',
    Prefix: `${directoryTrimmed}${directoryTrimmed ? '/' : ''}`,
  }

  const s3ListObjects = s3.listObjectsV2(params)
  const resp = await s3ListObjects.promise()
  return resp
}

const uploadToS3 = async (
  token, bucket: string, directory: string, file: File, s3ServerSideEncryption?: string
) => {
  const filename = encodeURIComponent(file.name)
  const s3 = getS3(token)

  const blob = await getFileContents(file)
  const key =
    `${directory.replace(/^\//, '').replace(/\/$/, '')}/`
    + `${filename.replace(/\s/g, '-')}`

  const params = {
    ACL: 'public-read',
    Bucket: bucket,
    Key: key,
    Body: blob,
    CacheControl: 'max-age=630720000, public',
    ContentType: file.type,
  }

  if (s3ServerSideEncryption) {
    params.ServerSideEncryption = s3ServerSideEncryption
  }

  const s3Upload = s3.upload(params)
  return await s3Upload.promise()
}

const deleteFromS3 = async (token, bucket: string, key: string) => {
  const s3 = getS3(token)

  const params = {
    Bucket: bucket,
    Key: key,
  }

  const s3DeleteObject = s3.deleteObject(params)
  await s3DeleteObject.promise()
}

const getNewS3StsToken = async () => {
  const res = await fetch(`/api/s3-sts-token`)
  const data = await res.json()

  if (data.error) {
    console.error(data.error)
    throw data.error
  }

  return data
}

const isNonExpiredS3StsToken = (token, createdAt: number): boolean => {
  return (
    token !== null
    && createdAt !== null
    && Math.floor((Date.now() - createdAt) / 1000) < 60 * 59
  )
}

const getS3 = (token) => {
  return new S3({
    accessKeyId: token.Credentials.AccessKeyId,
    secretAccessKey: token.Credentials.SecretAccessKey,
    sessionToken: token.Credentials.SessionToken,
  })
}

const getFileContents = (file: File): Promise<any> => {
  return new Promise(resolve => {
    const reader = new FileReader()
    reader.onload = readEvent => {
      resolve(readEvent.target?.result)
    }

    reader.readAsArrayBuffer(file)
  })
}

const prefixToMedia = (item: S3PrefixObject): Media => {
  const directory = item.Prefix.substr(0, item.Prefix.lastIndexOf('/'))

  const mediaItem: Media = {
    id: directory,
    filename: directory,
    directory: '',
    type: 'dir',
  }

  return mediaItem
}

const objectToMedia = (
  item: S3UploadObject | S3ListObject, s3ReadUrl: string
): Media => {
  const previewable = ['jpg', 'jpeg', 'png', 'webp', 'svg']
  const directory = item.Key.substr(0, item.Key.lastIndexOf('/'))
  const filenameOnly = item.Key.substr(item.Key.lastIndexOf('/') + 1)
  const extension = item.Key.substr(item.Key.lastIndexOf('.') + 1)

  const mediaItem: Media = {
    id: item.Key,
    filename: filenameOnly,
    directory,
    type: 'file',
  }

  if (previewable.includes(extension.toLowerCase())) {
    mediaItem.previewSrc =
      `${s3ReadUrl}${s3ReadUrl.endsWith('/') ? '' : '/'}`
      + `${directory}${directory ? '/' : ''}${filenameOnly}`
  }

  return mediaItem
}
