import Head from 'next/head'
import { getGithubPreviewProps, parseJson } from 'next-tinacms-github'
import { GetStaticProps } from 'next'
import styles from '../styles/Home.module.css'
import { usePlugin } from 'tinacms'
import {
  useGithubJsonForm,
  useGithubToolbarPlugins,
} from 'react-tinacms-github'

export default function Home({ file, s3ReadUrl }) {
  const formOptions = {
    label: 'Home Page',
    fields: [
      { name: 'title', component: 'text' },
      {
        label: 'Hero image',
        name: 'heroImage',
        component: 'image',
        parse: media => `/${media.directory}/${media.filename}`,
        uploadDir: () => '/hero-image/',
      }
    ],
  }

  const [data, form] = useGithubJsonForm(file, formOptions)
  usePlugin(form)

  useGithubToolbarPlugins()

  return (
    <div className={styles.container}>
      <Head>
        <title>Create Next App</title>
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <main className={styles.main}>
        <h1 className={styles.title}>
          {data.title}
        </h1>

        {data.heroImage &&
          <img
            src={
              `${s3ReadUrl}${s3ReadUrl.endsWith('/') ? '' : '/'}`
              + `${data.heroImage.replace(/^\/+/, '')}`
            }
            style={{ maxWidth: "100%" }}
          />
        }
      </main>
    </div>
  )
}

export const getStaticProps: GetStaticProps = async function({
  preview,
  previewData,
}) {
  if (preview) {
    return getGithubPreviewProps({
      ...previewData,
      fileRelativePath: 'content/home.json',
      parse: parseJson,
    })
  }
  return {
    props: {
      sourceProvider: null,
      error: null,
      preview: false,
      file: {
        fileRelativePath: 'content/home.json',
        data: (await import('../content/home.json')).default,
      },
    },
  }
}
