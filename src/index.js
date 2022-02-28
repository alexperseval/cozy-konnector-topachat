const {
  BaseKonnector,
  requestFactory,
  scrape,
  log,
  saveBills
} = require('cozy-konnector-libs')

const moment = require('moment')
const cheerio = require('cheerio')

const request = requestFactory({
  cheerio: true,
  json: false,
  jar: true
  // debug: true
})

const requestJSON = requestFactory({
  cheerio: false,
  json: true,
  jar: true
  // debug: true
})

const VENDOR = 'topachat'
// const baseUrl = 'https://www.topachat.com/'
const secureUrl = 'https://secure.topachat.com'

module.exports = new BaseKonnector(start)

async function start(fields, cozyParameters) {
  log('info', 'Authenticating ...')
  if (cozyParameters) log('debug', 'Found COZY_PARAMETERS')
  await getVerificationToken(fields.email)
  await authenticate.bind(this)(fields.email, fields.password)

  log('info', 'Successfully logged in')

  const yearsWithBill = await requestJSON.post(
    `${secureUrl}/Orders/CompletedOrdersPeriodSelection`
  )

  if (yearsWithBill) {
    log('info', 'Fetching the list of bills')

    let billsDetailsUrl = []

    for (var year of yearsWithBill) {
      const yearDetails = await request.post(
        `${secureUrl}/Orders/PartialCompletedOrdersHeader`,
        {
          form: {
            Duration: year['Duration'],
            Value: year['Value']
          }
        }
      )

      const $ = cheerio.load(yearDetails.html())
      $('.historic-cell--details > a').each(function() {
        billsDetailsUrl.push($(this).attr('href'))
      })
    }

    const billsFinal = parseBills(billsDetailsUrl)
    billsFinal.then(async function(result) {
      if (result) {
        await saveBills(result, fields, {
          identifiers: ['topachat'], // name of the target website
          contentType: 'application/pdf',
          linkBankOperations: false
        })
      }
    })
  }
}

// Il y a un token à récupérer pour se log en fonction de l'email
function getVerificationToken(email) {
  return request.get({
    method: 'GET',
    url: `${secureUrl}/Security/PartialCaptchaByIpOrEmail?email=${email}`
  })
}

function authenticate(email, password) {
  return this.signin({
    url: `https://secure.topachat.com/Login/Login`,
    formSelector: 'form',
    formData: {
      Email: email,
      Password: password
    },
    validate: (statusCode, $) => {
      if (
        $(`a[href='https://secure.topachat.com/Account/Logout']`).length === 1
      ) {
        return true
      } else {
        log('error', $('.error').text())
        return false
      }
    }
  })
}

async function parseBills(urls) {
  let bills = []

  for (let url of urls) {
    const $ = await request.post(secureUrl + url)
    const bill = scrape(
      $,
      {
        id: {
          sel: '.order__extra a',
          attr: 'href',
          parse: parseId
        },
        title: {
          sel: '.order-cell--designation'
        },
        date: {
          sel: '.order__extra a',
          attr: 'href',
          parse: parseDate
        },
        amount: {
          sel: '.order-cell--total',
          parse: amount => parseFloat(amount.replace('€', '.'))
        },
        fileurl: {
          sel: '.order__extra a',
          attr: 'href',
          parse: url => `${secureUrl}${url}`
        },
        filename: {
          sel: '.order-cell--designation'
        }
      },
      '.order'
    )
    bills.push(
      bill.map(bill => ({
        ...bill,
        filename:
          moment(bill['date']).format('YYYY-MM-DD') +
          ' - ' +
          bill['title'] +
          '.pdf',
        vendor: VENDOR,
        currency: '€'
      }))[0]
    )
  }
  return bills
}

function parseId(id) {
  return id
    .split('?')[1]
    .split('&')[0]
    .split('=')[1]
}

function parseDate(date) {
  const d = decodeURIComponent(
    date
      .split('?')[1]
      .split('&')[1]
      .split('=')[1]
  )
    .split(' ')[0]
    .split('/')
  const year = d[2]
  const month = d[0] - 1
  const day = d[1]
  return new Date(Date.UTC(year, month, day))
}
