const { expect } = require("chai");
const hre = require("hardhat");
const { web3, deployments, waffle, ethers, artifacts} = hre;
const { provider, deployMockContract } = waffle

const ALCHEMY_ID = process.env.ALCHEMY_POLYGON_ID;

const impersonate = require("../../scripts/impersonate.js")
const deployAndEnableConnector = require("../../scripts/polygon/deployAndEnableConnector.js")
const buildDSAv2 = require("../../scripts/polygon/buildDSAv2")
const encodeSpells = require("../../scripts/polygon/encodeSpells.js")
const getMasterSigner = require("../../scripts/polygon/getMasterSigner")

const addresses = require("../../scripts/polygon/constant/addresses");
const abis = require("../../scripts/constant/abis");
const tokens = require("../../scripts/polygon/constant/tokens");

const connectV2AaveV2Artifacts = require("../../artifacts/contracts/polygon/connectors/aave/v2/main.sol/ConnectV2AaveV2Polygon.json")
const connectV2PoolTogetherV4Artifacts = require("../../artifacts/contracts/polygon/connectors/pooltogether_v4/main.sol/ConnectV2PoolTogetherV4Polygon.json")

const PrizeDistributionBuffer = require('./artifacts/PrizeDistributionBuffer.json')
const DrawBuffer = require('./artifacts/DrawBuffer.json')

// https://www.npmjs.com/package/@pooltogether/draw-calculator-js
const {drawCalculator, Draw, PrizeDistribution, generatePicks, prepareClaims, computePicks, batchCalculateDrawResults, calculateNumberOfPicksForUser } = require("@pooltogether/draw-calculator-js")

// Mainnet Test Addresses https://v4.docs.pooltogether.com/protocol/reference/deployments/mainnet
const PRIZE_POOL_ADDR = "0x19DE635fb3678D8B8154E37d8C9Cdf182Fe84E60" // Prize Pool
const PRIZE_POOL_TOKEN_ADDR = "0x2791bca1f2de4661ed88a30c99a7a9449aa84174"   // ERC20 USDC
const PRIZE_POOL_TICKET_ADDR = "0x6a304dFdb9f808741244b6bfEe65ca7B3b3A6076"    // ERC20 TICKET 
const PRIZE_DISTRIBUTOR_ADDR = "0x8141BcFBcEE654c5dE17C4e2B2AF26B67f9B9056"
const PRIZE_DISTRIBUTION_BUFFER_ADDR = "0xcf6030BDEaB4E503D186426510aD88C1DA7125A3"
const DRAW_BEACON_ADDR = "0x0D33612870cd9A475bBBbB7CC38fC66680dEcAC5"
const DRAW_BUFFER_ADDR = "0x44B1d66E7B9d4467139924f31754F34cbC392f44"
const DRAW_CALCULATOR_ADDR = "0x3976BD6F4B82C97314570A77bc1e979f7A839A24"

const TICKET_ABI = [
    "function delegateOf(address _user) external view returns (address)",
    "function getBalanceAt(address user, uint64 timestamp) external view returns (uint256)",
    "function balanceOf(address user) external view returns (uint256)"
]

const DRAW_CALCULATOR_ABI = [
    "function getPrizeDistributionBuffer() external view returns (IPrizeDistributionBuffer)",
    "function getNormalizedBalancesForDrawIds(address _user, uint32[] calldata _drawIds) external view returns (uint256[] memory)"
]

const RNGBLOCKHASH_ABI = [
    "function getRequestFee() external view returns (address feeToken, uint256 requestFee)",
    "function isRequestComplete(uint32 requestId) external view returns (bool isCompleted)",
    "function randomNumber(uint32 requestId) external returns (uint256 randomNum)",
    "function getLastRequestId() external view returns (uint32 requestId)",
    "function requestRandomNumber() external returns (uint32 requestId, uint32 lockBlock)"
]

describe("PoolTogether", function () {
    const connectorName = "AAVEV2-TEST-A"
    const ptConnectorName = "POOLTOGETHERV4-TEST-A"
    
    let dsaWallet0
    let masterSigner;
    let instaConnectorsV2;
    let connector;
    let ptConnector;
    let winningRandomNumber;
    
    const wallets = provider.getWallets()
    const [wallet0, wallet1, wallet2, wallet3] = wallets
    before(async () => {
        await hre.network.provider.request({
            method: "hardhat_reset",
            params: [
              {
                forking: {
                  jsonRpcUrl: `https://polygon-mainnet.g.alchemy.com/v2/${ALCHEMY_ID}`,
                  blockNumber: 20533210,    // Just after draw 8 ended
                },
              },
            ],
          });

        masterSigner = await getMasterSigner(wallet3)
        instaConnectorsV2 = await ethers.getContractAt(abis.core.connectorsV2, addresses.core.connectorsV2);

        // Deploy and enable Aave Connector
        connector = await deployAndEnableConnector({
            connectorName,
            contractArtifact: connectV2AaveV2Artifacts,
            signer: masterSigner,
            connectors: instaConnectorsV2
        })

        // Deploy and enable Pool Together Connector
        ptConnector = await deployAndEnableConnector({
            connectorName: ptConnectorName,
            contractArtifact: connectV2PoolTogetherV4Artifacts,
            signer: masterSigner,
            connectors: instaConnectorsV2
        })
  })

  it("Should have contracts deployed.", async function () {
    expect(!!instaConnectorsV2.address).to.be.true;
    expect(!!connector.address).to.be.true;
    expect(!!ptConnector.address).to.be.true;
    expect(!!masterSigner.address).to.be.true;
  });

  describe("DSA wallet setup", function () {
    it("Should build DSA v2", async function () {
        dsaWallet0 = await buildDSAv2(wallet0.address)
        expect(!!dsaWallet0.address).to.be.true;
    });

    it("Should compute winning pick from hashed dsaWallet0.address", async function() {
        // First pick generated from hashed dsaWallet0.address
        const hashedAddress = ethers.utils.solidityKeccak256(['address'], [dsaWallet0.address]);
        const pick0 = computePicks(hashedAddress,[ethers.BigNumber.from(0)])[0];
        winningRandomNumber = pick0.hash;
        console.log("WinningRandomNumber: ", winningRandomNumber);
    })

    it("Deposit 1000 MATIC into DSA wallet", async function () {
        await wallet0.sendTransaction({
            to: dsaWallet0.address,
            value: ethers.utils.parseEther("1000")
        });
        expect(await ethers.provider.getBalance(dsaWallet0.address)).to.be.gte(ethers.utils.parseEther("10"));
    });
  });

  describe("Main - Prize Pool Test", function () {

    it("Should deposit 1000 MATIC in AAVE V2", async function () {
        const amount = ethers.utils.parseEther("1000") // 1000 MATIC
        const spells = [
            {
                connector: connectorName,
                method: "deposit",
                args: [tokens.matic.address, amount, 0, 0]
            }
        ]

        const tx = await dsaWallet0.connect(wallet0).cast(...encodeSpells(spells), wallet1.address)
        const receipt = await tx.wait()
        expect(await ethers.provider.getBalance(dsaWallet0.address)).to.be.lte(ethers.utils.parseEther("5"));
    });

    it("Should borrow 100 USDC from AAVE V2 and deposit 100 USDC into USDC Prize Pool without delegating (depositTo)", async function () {
        const borrowAmount = ethers.utils.parseUnits("500", 6);
        const amount = ethers.utils.parseUnits("100", 6) // 100 USDC 
        const spells = [
            {
                connector: connectorName,
                method: "borrow",
                args: [tokens.usdc.address, borrowAmount, 2, 0, 0]
            },
            {
                connector: ptConnectorName,
                method: "deposit",
                args: [PRIZE_POOL_ADDR, amount, 0, 0]
            }
        ]
        const usdcToken = await ethers.getContractAt(abis.basic.erc20, PRIZE_POOL_TOKEN_ADDR);
        const ticketToken = await ethers.getContractAt(TICKET_ABI, PRIZE_POOL_TICKET_ADDR);

        // Before Spell
        const balance = await usdcToken.balanceOf(dsaWallet0.address)
        console.log("TokenBalanceBefore:    ", balance.toString());
        expect(balance, `USDC balance is 0`).to.be.eq(ethers.utils.parseUnits("0", 6));

        // ticket.balanceOf is users total tickets deposited
        // ticket.getBalanceAt is users balance delegated to them. In this case using "depositTo", the deposit is not delegated to anyone so user is not eligibile to win.
        const ticketBalanceOf = await ticketToken.balanceOf(dsaWallet0.address);
        const ticketBalanceAt = await ticketToken.getBalanceAt(dsaWallet0.address, (await ethers.provider.getBlock('latest')).timestamp);
        console.log("TicketBalanceOfBefore: ", ticketBalanceOf.toString());
        console.log("TicketBalanceAtBefore: ", ticketBalanceAt.toString());
        expect(ticketBalanceOf, `PoolTogether Ticket balance equals 0`).to.be.eq(ethers.utils.parseUnits("0", 6));
        expect(ticketBalanceAt, `PoolTogether Ticket eligible to win balance equals 0`).to.be.eq(ethers.utils.parseUnits("0", 6));

        // Run spell transaction
        const tx = await dsaWallet0.connect(wallet0).cast(...encodeSpells(spells), wallet1.address)
        const receipt = await tx.wait()

        // After spell
        // usdcBalance = await usdcToken.balanceOf(dsaWallet0.address);
        const balanceAfter = await usdcToken.balanceOf(dsaWallet0.address);
        console.log("TokenBalanceAfter:     ", balanceAfter.toString());
        expect(balanceAfter, `Token balance equals 500`).to.be.eq(ethers.utils.parseUnits("400", 6));

        const ticketBalanceOfAfter = await ticketToken.balanceOf(dsaWallet0.address);
        const ticketBalanceAtAfter = await ticketToken.getBalanceAt(dsaWallet0.address, (await ethers.provider.getBlock('latest')).timestamp);
        console.log("TicketBalanceOfAfter:  ", ticketBalanceOfAfter.toString());
        console.log("TicketBalanceAtAfter:  ", ticketBalanceAtAfter.toString());
        expect(ticketBalanceOfAfter, `PoolTogether Ticket balance equals 100`).to.be.eq(ethers.utils.parseUnits("100", 6));
        expect(ticketBalanceAtAfter, `PoolTogether Ticket elgible to win balance equals 0`).to.be.eq(ethers.utils.parseUnits("0", 6));
    });

    it("Should deposit USDC into USDC Prize Pool and delegate to dsaWallet0", async function () {
        const amount = ethers.utils.parseUnits("100", 6) // 100 USDC 
        const spells = [
            {
                connector: ptConnectorName,
                method: "depositAndDelegate",
                args: [PRIZE_POOL_ADDR, amount, dsaWallet0.address, 0, 0]
            }
        ]

        // Before Spell
        const usdcToken = await ethers.getContractAt(abis.basic.erc20, PRIZE_POOL_TOKEN_ADDR);
        const balance = await usdcToken.balanceOf(dsaWallet0.address);
        console.log("TokenBalanceBefore:    ", balance.toString());
        expect(balance, `USDC balance is 400`).to.be.eq(ethers.utils.parseUnits("400", 6));

        const ticketToken = await ethers.getContractAt(TICKET_ABI, PRIZE_POOL_TICKET_ADDR);
        const ticketBalanceOf = await ticketToken.balanceOf(dsaWallet0.address);
        const ticketBalanceAt = await ticketToken.getBalanceAt(dsaWallet0.address, (await ethers.provider.getBlock('latest')).timestamp);
        console.log("TicketBalanceOfBefore: ", ticketBalanceOf.toString());
        console.log("TicketBalanceAtBefore: ", ticketBalanceAt.toString());
        expect(ticketBalanceOf, `PoolTogether Ticket balance equals 100`).to.be.eq(ethers.utils.parseUnits("100", 6));
        expect(ticketBalanceAt, `PoolTogether Ticket elgible to win balance equals 0`).to.be.eq(ethers.utils.parseUnits("0", 6));

        // Run spell transaction
        const tx = await dsaWallet0.connect(wallet0).cast(...encodeSpells(spells), wallet1.address)
        const receipt = await tx.wait()

        // After spell
        const balanceAfter = await usdcToken.balanceOf(dsaWallet0.address);
        console.log("TokenBalanceAfter:     ", balanceAfter.toString());
        expect(balanceAfter, `Token balance equals 300`).to.be.eq(ethers.utils.parseUnits("300", 6));

        const ticketBalanceOfAfter = await ticketToken.balanceOf(dsaWallet0.address);
        const ticketBalanceAtAfter = await ticketToken.getBalanceAt(dsaWallet0.address, (await ethers.provider.getBlock('latest')).timestamp);
        console.log("TicketBalanceOfAfter:  ", ticketBalanceOfAfter.toString());
        console.log("TicketBalanceAtAfter:  ", ticketBalanceAtAfter.toString());
        expect(ticketBalanceOfAfter, `PoolTogether Ticket balance equals 200`).to.be.eq(ethers.utils.parseUnits("200", 6));
        expect(ticketBalanceAtAfter, `PoolTogether Ticket elgible to win balance equals 200`).to.be.eq(ethers.utils.parseUnits("200", 6));
    });

    it("Should withdraw 200 USDC from USDC Prize Pool", async function () {
        const amount = ethers.utils.parseUnits("200", 6) // USDC 
        const setId = "83478237"
        const spells = [
            {
                connector: ptConnectorName,
                method: "withdraw",
                args: [PRIZE_POOL_ADDR, amount, 0, 0]
            }
        ]

        // Before Spell
        let usdcToken = await ethers.getContractAt(abis.basic.erc20, PRIZE_POOL_TOKEN_ADDR)
        const balance = await usdcToken.balanceOf(dsaWallet0.address)
        console.log("TokenBalanceBefore:    ", balance.toString());
        expect(balance, `USDC balance is 300`).to.be.eq(ethers.utils.parseUnits("300", 6));

        const ticketToken = await ethers.getContractAt(TICKET_ABI, PRIZE_POOL_TICKET_ADDR);
        const ticketBalanceOf = await ticketToken.balanceOf(dsaWallet0.address);
        const ticketBalanceAt = await ticketToken.getBalanceAt(dsaWallet0.address, (await ethers.provider.getBlock('latest')).timestamp);
        console.log("TicketBalanceOfBefore: ", ticketBalanceOf.toString());
        console.log("TicketBalanceAtBefore: ", ticketBalanceAt.toString());
        expect(ticketBalanceOf, `PoolTogether Ticket balance equals 200`).to.be.eq(ethers.utils.parseUnits("200", 6));
        expect(ticketBalanceAt, `PoolTogether Ticket elgible to win balance equals 200`).to.be.eq(ethers.utils.parseUnits("200", 6));

        // Run spell transaction
        const tx = await dsaWallet0.connect(wallet0).cast(...encodeSpells(spells), wallet1.address)
        const receipt = await tx.wait()

        // After spell
        const balanceAfter = await usdcToken.balanceOf(dsaWallet0.address);
        console.log("TokenBalanceAfter:     ", balanceAfter.toString());
        expect(balanceAfter, `Token balance equals 500`).to.be.eq(ethers.utils.parseUnits("500", 6));

        const ticketBalanceOfAfter = await ticketToken.balanceOf(dsaWallet0.address);
        const ticketBalanceAtAfter = await ticketToken.getBalanceAt(dsaWallet0.address, (await ethers.provider.getBlock('latest')).timestamp);
        console.log("TicketBalanceOfAfter:  ", ticketBalanceOfAfter.toString());
        console.log("TicketBalanceAtAfter:  ", ticketBalanceAtAfter.toString());
        expect(ticketBalanceAtAfter, `PoolTogether Ticket elgible to win balance equals 0`).to.be.eq(ethers.utils.parseUnits("0", 6));
        expect(ticketBalanceOfAfter, `PoolTogether Ticket balance equals 0`).to.be.eq(ethers.utils.parseUnits("0", 6));
    });

    it("Should deposit USDC into USDC Prize Pool and delegate to dsaWallet0", async function () {
        const amount = ethers.utils.parseUnits("500", 6) // 500 USDC
        const setId = "83478237"
        const spells = [
            {
                connector: ptConnectorName,
                method: "deposit",
                args: [PRIZE_POOL_ADDR, amount, 0, 0]
            },
            {
                connector: ptConnectorName,
                method: "delegate",
                args: [PRIZE_POOL_TICKET_ADDR, dsaWallet0.address]
            }
        ]
        const usdcToken = await ethers.getContractAt(abis.basic.erc20, PRIZE_POOL_TOKEN_ADDR);

        // Before Spell
        const balance = await usdcToken.balanceOf(dsaWallet0.address)
        console.log("TokenBalanceBefore:    ", balance.toString());
        expect(balance, `USDC balance is 500`).to.be.eq(ethers.utils.parseUnits("500", 6));

        const ticketToken = await ethers.getContractAt(TICKET_ABI, PRIZE_POOL_TICKET_ADDR);
        const ticketBalanceOf = await ticketToken.balanceOf(dsaWallet0.address);
        const ticketBalanceAt = await ticketToken.getBalanceAt(dsaWallet0.address, (await ethers.provider.getBlock('latest')).timestamp);
        console.log("TicketBalanceOfBefore: ", ticketBalanceOf.toString());
        console.log("TicketBalanceAtBefore: ", ticketBalanceAt.toString());
        expect(ticketBalanceAt, `PoolTogether Ticket elgible to win balance equals 0`).to.be.eq(ethers.utils.parseUnits("0", 6));
        expect(ticketBalanceOf, `PoolTogether Ticket balance equals 0`).to.be.eq(ethers.utils.parseUnits("0", 6));

        // Run spell transaction
        const tx = await dsaWallet0.connect(wallet0).cast(...encodeSpells(spells), wallet1.address)
        const receipt = await tx.wait()

        // After spell
        const balanceAfter = await usdcToken.balanceOf(dsaWallet0.address);
        console.log("TokenBalanceAfter:     ", balanceAfter.toString());
        expect(balanceAfter, `Token balance equals 400`).to.be.eq(ethers.utils.parseUnits("0", 6));

        const ticketBalanceOfAfter = await ticketToken.balanceOf(dsaWallet0.address);
        const ticketBalanceAtAfter = await ticketToken.getBalanceAt(dsaWallet0.address, (await ethers.provider.getBlock('latest')).timestamp);
        console.log("TicketBalanceOfAfter:  ", ticketBalanceOfAfter.toString());
        console.log("TicketBalanceAtAfter:  ", ticketBalanceAtAfter.toString());
        expect(ticketBalanceOfAfter, `PoolTogether Ticket balance equals 100`).to.be.eq(ethers.utils.parseUnits("500", 6));
        expect(ticketBalanceAtAfter, `PoolTogether Ticket elgible to win balance equals 100`).to.be.eq(ethers.utils.parseUnits("500", 6));
    });

    it("Trigger draw, claim winnings and withdraw winnings to dsaWallet0", async function () {
        const amount = ethers.utils.parseUnits("100", 6) // 100 USDC 
        const setId = "83478237"
        const drawId = 9

        // Impersonate owner to set pushPrizeDistribution and pushDraw so we can set random number to always win
        const OWNER_ADDR = "0xd2146c8D93fD7Edd45C07634af7038E825880a64"
        const owner = await impersonate([OWNER_ADDR]);
        await wallet0.sendTransaction({
            to: OWNER_ADDR,
            value: ethers.utils.parseEther("1")
        });

        // Get next drawId
        const drawCalculatorContract = await ethers.getContractAt(DRAW_CALCULATOR_ABI, DRAW_CALCULATOR_ADDR);
        const prizeDistributionBufferContract = await ethers.getContractAt(PrizeDistributionBuffer.abi, PRIZE_DISTRIBUTION_BUFFER_ADDR);    

        // Get previous prizeDistribution
        // https://v4.docs.pooltogether.com/protocol/concepts/prize-distribution
        const prizeDistribution = await prizeDistributionBufferContract.getPrizeDistribution(drawId-1);
        console.log(prizeDistribution);
        console.log("NumberofPicks:", prizeDistribution.numberOfPicks.toString());
        console.log("prize:", prizeDistribution.prize.toString());

        // Push prizeDistribution
        await prizeDistributionBufferContract.connect(owner[0]).pushPrizeDistribution(drawId, prizeDistribution);

        // Set Draw with our winning Random number
        const drawBufferContract = await ethers.getContractAt(DrawBuffer.abi, DRAW_BUFFER_ADDR);
        const drawData = {
            winningRandomNumber,
            drawId,
            timestamp: 1635102210,
            beaconPeriodStartedAt: 1635015600,
            beaconPeriodSeconds: 86400
        }
        await drawBufferContract.connect(owner[0]).pushDraw(drawData);

        // User normalized Balances, used to determine number of picks
        const normalizedBalances = await drawCalculatorContract.getNormalizedBalancesForDrawIds(dsaWallet0.address,[drawId]);
        console.log("\nNormalized Balances For DrawIds: ", normalizedBalances.toString());
        console.log("User number of Picks", calculateNumberOfPicksForUser(prizeDistribution, ethers.BigNumber.from(normalizedBalances.toString())));

        const draw = await drawBufferContract.getDraw(drawId);
        console.log("\nDRAW DATA");
        console.log("drawId: ", draw.drawId);
        console.log("timestamp:: ", draw.timestamp.toString());
        console.log("winningRandomNumber: ", draw.winningRandomNumber);

        const user = {
            address: dsaWallet0.address,
            normalizedBalances
        }
        
        // Use draw data to determine what prizes user won
        const results = batchCalculateDrawResults([prizeDistribution], [draw], user)
        for (let i = 0; i < results.length; i++) {
            console.log("\nDraw id: ", results[i].drawId);
            for (let j = 0; j < results[i].prizes.length; j++) {    
                console.log("\tPrize Pick", results[i].prizes[j].pick.toString());            
                console.log("\t\tamount", results[i].prizes[j].amount.toString());
                console.log("\t\tindex (Tier)", results[i].prizes[j].distributionIndex);
            }
            console.log("TotalValue: ", results[i].totalValue.toString());
        }

        // Prepare data for claim transaction
        const claim = prepareClaims(user, results);

        const spells = [
            {
                connector: ptConnectorName,
                method: "claim",
                args: [PRIZE_DISTRIBUTOR_ADDR, claim.drawIds, claim.encodedWinningPickIndices, setId]
            },
            {
                connector: ptConnectorName,
                method: "withdraw",
                args: [PRIZE_POOL_ADDR, amount, setId, 0]
            }
        ]

        // Before Spell
        let usdcToken = await ethers.getContractAt(abis.basic.erc20, PRIZE_POOL_TOKEN_ADDR)
        let balance = await usdcToken.balanceOf(dsaWallet0.address);
        console.log("\nTokenBalanceBefore: ", balance.toString());
        expect(balance, `USDC balance is 0`).to.be.eq(ethers.utils.parseUnits("0", 6));

        const ticketToken = await ethers.getContractAt(TICKET_ABI, PRIZE_POOL_TICKET_ADDR);
        const ticketBalanceOf = await ticketToken.balanceOf(dsaWallet0.address);
        const ticketBalanceAt = await ticketToken.getBalanceAt(dsaWallet0.address, (await ethers.provider.getBlock('latest')).timestamp);
        console.log("TicketBalanceOfBefore: ", ticketBalanceOf.toString());
        console.log("TicketBalanceAtBefore: ", ticketBalanceAt.toString());
        expect(ticketBalanceOf, `PoolTogether Ticket balance equals 0`).to.be.eq(ethers.utils.parseUnits("500", 6));
        expect(ticketBalanceAt, `PoolTogether Ticket elgible to win balance equals 0`).to.be.eq(ethers.utils.parseUnits("500", 6));

        // // Run spell transaction
        const tx = await dsaWallet0.connect(wallet0).cast(...encodeSpells(spells), wallet1.address)
        const receipt = await tx.wait()

        // After spell
        const balanceAfter = await usdcToken.balanceOf(dsaWallet0.address);
        console.log("TokenBalanceAfter:     ", balanceAfter.toString());
        expect(balanceAfter, `Expect USDC balance be greater than 0 since withdraw some winnings`).to.be.gt(0);

        const ticketBalanceOfAfter = await ticketToken.balanceOf(dsaWallet0.address);
        const ticketBalanceAtAfter = await ticketToken.getBalanceAt(dsaWallet0.address, (await ethers.provider.getBlock('latest')).timestamp);
        console.log("TicketBalanceOfAfter:  ", ticketBalanceOfAfter.toString());
        console.log("TicketBalanceAtAfter:  ", ticketBalanceAtAfter.toString());
        expect(ticketBalanceOfAfter, `PoolTogether Ticket balance equals 100`).to.be.eq(ethers.utils.parseUnits("500", 6));
        expect(ticketBalanceAtAfter, `PoolTogether Ticket elgible to win balance equals 100`).to.be.eq(ethers.utils.parseUnits("500", 6));
    });
  })
})